-- Página de captura compartida: ejecuta TODO el archivo. No requiere Teams.
begin;
alter table public.prisma_orders add column if not exists started_at timestamptz;
alter table public.prisma_orders add column if not exists ended_at timestamptz;
alter table public.prisma_orders add column if not exists np text not null default '';
alter table public.prisma_orders add column if not exists source text not null default 'manual';
alter table public.prisma_orders add column if not exists received_at timestamptz;
alter table public.prisma_orders add column if not exists scheduled_date date;
alter table public.prisma_orders add column if not exists scheduled_start text;
alter table public.prisma_orders add column if not exists scheduled_end text;
alter table public.prisma_orders add column if not exists pieces numeric;
alter table public.prisma_orders add column if not exists planned_meters numeric;
alter table public.prisma_orders add column if not exists specifications jsonb not null default '{}'::jsonb;
create or replace function public.prisma_order_clock(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.prisma_orders%rowtype;op text:=payload->>'operation';stamp timestamptz;
begin
 perform public.prisma_authorize();perform pg_advisory_xact_lock(104202611);
 select * into r from public.prisma_orders where id=(payload->>'id')::bigint for update;
 if not found or r.status='cancelled' then raise exception 'Orden no encontrada o cancelada.';end if;
 stamp:=clock_timestamp();
 if op='start' then
  if r.ended_at is not null then raise exception 'La orden ya finalizó.';end if;
  update public.prisma_orders set started_at=coalesce(started_at,stamp) where id=r.id returning * into r;
 elsif op='finish' then
  if r.started_at is null then raise exception 'Primero inicia la orden.';end if;
  update public.prisma_orders set ended_at=coalesce(ended_at,stamp) where id=r.id returning * into r;
 else raise exception 'Acción de cronómetro no válida.';end if;
 return jsonb_build_object('id',r.id,'started_at',r.started_at,'ended_at',r.ended_at);
end $$;
create or replace function public.prisma_stop_cancelled_order() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if new.status='cancelled' and new.started_at is not null and new.ended_at is null then new.ended_at:=clock_timestamp();end if;
 return new;
end $$;
drop trigger if exists stop_cancelled_order on public.prisma_orders;
create trigger stop_cancelled_order before update of status on public.prisma_orders for each row execute function public.prisma_stop_cancelled_order();
alter table public.prisma_orders add column if not exists machine text not null default '';
alter table public.prisma_orders add column if not exists queue_number bigint;
create unique index if not exists prisma_order_queue_number on public.prisma_orders(queue_number) where queue_number is not null;
create table if not exists public.prisma_order_portal_access(id integer primary key check(id=1),token_hash text not null,enabled boolean not null default true);
create table if not exists public.prisma_order_portal_submissions(request_key uuid primary key,order_id bigint not null references public.prisma_orders(id),payload_hash text not null);
alter table public.prisma_order_portal_access enable row level security;
alter table public.prisma_order_portal_submissions enable row level security;
revoke all on public.prisma_order_portal_access,public.prisma_order_portal_submissions from public,anon,authenticated;
create or replace function public.prisma_manage_order_portal(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare secret text;enabled_value boolean;
begin
 perform public.prisma_authorize();perform pg_advisory_xact_lock(104202611);
 if payload->>'operation'='configure' then
  secret:='op_'||encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex');
  insert into public.prisma_order_portal_access(id,token_hash) values(1,encode(sha256(convert_to(secret,'UTF8')),'hex'))
  on conflict(id) do update set token_hash=excluded.token_hash,enabled=true;
 elsif payload->>'operation'='disable' then update public.prisma_order_portal_access set enabled=false where id=1;
 elsif payload->>'operation' is distinct from 'status' then raise exception 'Acción no válida.';end if;
 select enabled into enabled_value from public.prisma_order_portal_access where id=1;
 return jsonb_build_object('enabled',coalesce(enabled_value,false),'access_key',secret);
end $$;
create or replace function public.prisma_order_portal(access_key text,payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
<<portal>>
declare b jsonb:=payload->'order';old public.prisma_order_portal_submissions%rowtype;request_id uuid;signature text;oid bigint;n bigint;planned date;row_data jsonb;more boolean;cursor_value bigint;item jsonb;field text;maxlen integer;
begin
 if access_key is null or access_key !~ '^op_[a-f0-9]{64}$' then raise exception 'Enlace no autorizado.';end if;
 perform pg_advisory_xact_lock(104202611);
 if not exists(select 1 from public.prisma_order_portal_access where id=1 and enabled and token_hash=encode(sha256(convert_to(access_key,'UTF8')),'hex')) then raise exception 'El enlace fue desactivado o cambió. Solicita el enlace vigente.';end if;
 if payload->>'operation'='list' then
  cursor_value:=coalesce((payload->>'after_sequence')::bigint,0);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.queue_number),'[]'::jsonb) into row_data from
   (select id,queue_number,folio,np,product,client,pressman,machine,scheduled_date,scheduled_start,scheduled_end,pieces,planned_meters,specifications->>'colores' as colors,notes,status,started_at,ended_at,received_at
    from public.prisma_orders where source='portal' and queue_number>cursor_value and (coalesce((payload->>'include_finished')::boolean,false) or (status<>'cancelled' and ended_at is null)) order by queue_number limit 50)x;
  select exists(select 1 from public.prisma_orders where source='portal' and queue_number>coalesce((row_data->-1->>'queue_number')::bigint,cursor_value) and (coalesce((payload->>'include_finished')::boolean,false) or (status<>'cancelled' and ended_at is null))) into more;
  return jsonb_build_object('orders',row_data,'has_more',more);
 elsif payload->>'operation' is distinct from 'submit' then raise exception 'Acción no permitida.';end if;
 if b is null or jsonb_typeof(b)<>'object' or octet_length(b::text)>10000 then raise exception 'Datos de orden no válidos.';end if;
 request_id:=(payload->>'request_key')::uuid;if request_id is null then raise exception 'Falta la referencia de captura.';end if;
 signature:=encode(sha256(convert_to(b::text,'UTF8')),'hex');
 select * into old from public.prisma_order_portal_submissions where request_key=request_id;
 if found then
  if old.payload_hash<>signature then raise exception 'La captura ya fue enviada con otros datos. Recarga la lista antes de crear otra.';end if;
  select queue_number into n from public.prisma_orders where id=old.order_id;
  return jsonb_build_object('ok',true,'id',old.order_id,'queue_number',n,'duplicate',true);
 end if;
 for field,maxlen in select * from (values('folio',100),('np',100),('product',150),('pressman',100),('machine',40),('colors',1000))v(f,m) loop
  if coalesce(btrim(b->>field),'')='' or length(b->>field)>maxlen then raise exception 'Revisa el campo %.',field;end if;
 end loop;
 if length(coalesce(b->>'client',''))>150 or length(coalesce(b->>'notes',''))>1000 then raise exception 'Cliente o notas demasiado largos.';end if;
 if b->>'machine' not in ('Mark Andy','Comco 1','Comco 2','Maquina China') then raise exception 'Máquina no válida.';end if;
 if coalesce(b->>'scheduled_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Fecha no válida.';end if;
 planned:=(b->>'scheduled_date')::date;
 if coalesce(b->>'scheduled_start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (coalesce(b->>'scheduled_end','')<>'' and b->>'scheduled_end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'Hora no válida.';end if;
 if exists(select 1 from public.prisma_orders where source='portal' and status<>'cancelled' and upper(btrim(folio))=upper(btrim(b->>'folio')) and np=btrim(b->>'np') and scheduled_date=planned) then raise exception 'Esta orden y NP ya están registrados para esa fecha. Revisa la lista.';end if;
 select coalesce(max(queue_number),0)+1 into n from public.prisma_orders;
 insert into public.prisma_orders(folio,np,product,client,pressman,machine,date,status,source,received_at,queue_number,scheduled_date,scheduled_start,scheduled_end,pieces,planned_meters,specifications,notes)
 values(btrim(b->>'folio'),btrim(b->>'np'),btrim(b->>'product'),coalesce(btrim(b->>'client'),''),btrim(b->>'pressman'),b->>'machine',public.prisma_today(),'draft','portal',clock_timestamp(),n,planned,b->>'scheduled_start',nullif(b->>'scheduled_end',''),case when nullif(b->>'pieces','') is null then null else public.prisma_number(b->>'pieces','Piezas') end,case when nullif(b->>'meters','') is null then null else public.prisma_number(b->>'meters','Metros') end,jsonb_build_object('colores',btrim(b->>'colors')),coalesce(btrim(b->>'notes'),'')) returning id into oid;
 insert into public.prisma_order_portal_submissions values(request_id,oid,signature);
 return jsonb_build_object('ok',true,'id',oid,'queue_number',n,'duplicate',false);
end $$;
revoke all on function public.prisma_order_clock(jsonb),public.prisma_stop_cancelled_order(),public.prisma_manage_order_portal(jsonb),public.prisma_order_portal(text,jsonb) from public,anon,authenticated;
grant execute on function public.prisma_order_clock(jsonb),public.prisma_manage_order_portal(jsonb) to authenticated;
grant execute on function public.prisma_order_portal(text,jsonb) to anon,authenticated;
-- Catálogo de colores, solicitudes y preparación de mezclas.
alter table public.prisma_orders add column if not exists ink_selections jsonb not null default '[]'::jsonb;
create table if not exists public.prisma_pantone_requests(id bigint generated by default as identity primary key,order_id bigint not null references public.prisma_orders(id),slot integer not null,pantone text not null,status text not null default 'pending',created_at timestamptz not null default now(),prepared_at timestamptz,output_grams numeric,output_lot_id bigint references public.prisma_lots(id),unique(order_id,slot));
create table if not exists public.prisma_pantone_ingredients(id bigint generated by default as identity primary key,request_id bigint not null references public.prisma_pantone_requests(id),lot_id bigint not null references public.prisma_lots(id),grams numeric not null,cost_kg numeric not null);
alter table public.prisma_pantone_requests enable row level security;
alter table public.prisma_pantone_ingredients enable row level security;
revoke all on public.prisma_pantone_requests,public.prisma_pantone_ingredients from public,anon,authenticated;
create or replace function public.prisma_order_portal(access_key text,payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
<<portal>>
declare b jsonb:=payload->'order';old public.prisma_order_portal_submissions%rowtype;request_id uuid;signature text;oid bigint;n bigint;planned date;row_data jsonb;more boolean;cursor_value bigint;item jsonb;field text;maxlen integer;selections jsonb;selection jsonb;labels text[];product_row public.prisma_products%rowtype;slots integer[];slot_value integer;
begin
 if access_key is null or access_key !~ '^op_[a-f0-9]{64}$' then raise exception 'Enlace no autorizado.';end if;
 perform pg_advisory_xact_lock(104202611);
 if not exists(select 1 from public.prisma_order_portal_access where id=1 and enabled and token_hash=encode(sha256(convert_to(access_key,'UTF8')),'hex')) then raise exception 'El enlace fue desactivado o cambió. Solicita el enlace vigente.';end if;
 if payload->>'operation'='catalog' then
 return jsonb_build_object('products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'name',p.name,'kind',p.kind,'provider',p.provider,'available',exists(select 1 from public.prisma_lots l where l.product_id=p.id and l.grams>0)) order by p.name,p.code) from public.prisma_products p where p.category='tinta'),'[]'::jsonb));
 elsif payload->>'operation'='list' then
  cursor_value:=coalesce((payload->>'after_sequence')::bigint,0);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.queue_number),'[]'::jsonb) into row_data from
   (select id,queue_number,folio,np,product,client,pressman,machine,scheduled_date,scheduled_start,scheduled_end,pieces,planned_meters,specifications->>'colores' as colors,notes,status,started_at,ended_at,received_at
    from public.prisma_orders where source='portal' and queue_number>cursor_value and (coalesce((payload->>'include_finished')::boolean,false) or (status<>'cancelled' and ended_at is null)) order by queue_number limit 50)x;
  select exists(select 1 from public.prisma_orders where source='portal' and queue_number>coalesce((row_data->-1->>'queue_number')::bigint,cursor_value) and (coalesce((payload->>'include_finished')::boolean,false) or (status<>'cancelled' and ended_at is null))) into more;
  return jsonb_build_object('orders',row_data,'has_more',more);
 elsif payload->>'operation' is distinct from 'submit' then raise exception 'Acción no permitida.';end if;
 if b is null or jsonb_typeof(b)<>'object' or octet_length(b::text)>10000 then raise exception 'Datos de orden no válidos.';end if;
 request_id:=(payload->>'request_key')::uuid;if request_id is null then raise exception 'Falta la referencia de captura.';end if;
 signature:=encode(sha256(convert_to(b::text,'UTF8')),'hex');
 select * into old from public.prisma_order_portal_submissions where request_key=request_id;
 if found then
  if old.payload_hash<>signature then raise exception 'La captura ya fue enviada con otros datos. Recarga la lista antes de crear otra.';end if;
  select queue_number into n from public.prisma_orders where id=old.order_id;
  return jsonb_build_object('ok',true,'id',old.order_id,'queue_number',n,'duplicate',true);
 end if;
 for field,maxlen in select * from (values('folio',100),('np',100),('product',150),('pressman',100),('machine',40),('colors',1000))v(f,m) loop
  if coalesce(btrim(b->>field),'')='' or length(b->>field)>maxlen then raise exception 'Revisa el campo %.',field;end if;
 end loop;
 if length(coalesce(b->>'client',''))>150 or length(coalesce(b->>'notes',''))>1000 then raise exception 'Cliente o notas demasiado largos.';end if;
 if b->>'machine' not in ('Mark Andy','Comco 1','Comco 2','Maquina China') then raise exception 'Máquina no válida.';end if;
 if coalesce(b->>'scheduled_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Fecha no válida.';end if;
 planned:=(b->>'scheduled_date')::date;
 if coalesce(b->>'scheduled_start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (coalesce(b->>'scheduled_end','')<>'' and b->>'scheduled_end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'Hora no válida.';end if;
 if exists(select 1 from public.prisma_orders where source='portal' and status<>'cancelled' and upper(btrim(folio))=upper(btrim(b->>'folio')) and np=btrim(b->>'np') and scheduled_date=planned) then raise exception 'Esta orden y NP ya están registrados para esa fecha. Revisa la lista.';end if;
 selections:=coalesce(b->'ink_selections','[]'::jsonb);slots:=array[]::integer[];labels:=array[]::text[];
 if jsonb_typeof(selections)<>'array' or jsonb_array_length(selections)>(case when b->>'machine' in ('Comco 1','Comco 2') then 6 else 12 end) then raise exception 'Revisa las posiciones de color.';end if;
 for selection in select value from jsonb_array_elements(selections) loop
  slot_value:=(selection->>'slot')::integer;
  if slot_value is null or slot_value<1 or slot_value>(case when b->>'machine' in ('Comco 1','Comco 2') then 6 else 12 end) or slot_value=any(slots) then raise exception 'Posición de color no válida.';end if;
  slots:=array_append(slots,slot_value);
  if coalesce(btrim(selection->>'pantone'),'')<>'' then
   if length(selection->>'pantone')>100 or nullif(selection->>'product_id','') is not null then raise exception 'Pantone no válido.';end if;
   labels:=array_append(labels,'Pantone '||btrim(selection->>'pantone'));
  else
   select * into product_row from public.prisma_products where id=(selection->>'product_id')::bigint and category='tinta';if not found then raise exception 'Tinta de catálogo no encontrada.';end if;
   labels:=array_append(labels,product_row.name||' ['||product_row.code||']');
  end if;
 end loop;
 if cardinality(labels)>0 then b:=jsonb_set(b,'{colors}',to_jsonb(array_to_string(labels,' · ')));end if;
 select coalesce(max(queue_number),0)+1 into n from public.prisma_orders;
 insert into public.prisma_orders(folio,np,product,client,pressman,machine,date,status,source,received_at,queue_number,scheduled_date,scheduled_start,scheduled_end,pieces,planned_meters,specifications,notes,ink_selections)
 values(btrim(b->>'folio'),btrim(b->>'np'),btrim(b->>'product'),coalesce(btrim(b->>'client'),''),btrim(b->>'pressman'),b->>'machine',public.prisma_today(),'draft','portal',clock_timestamp(),n,planned,b->>'scheduled_start',nullif(b->>'scheduled_end',''),case when nullif(b->>'pieces','') is null then null else public.prisma_number(b->>'pieces','Piezas') end,case when nullif(b->>'meters','') is null then null else public.prisma_number(b->>'meters','Metros') end,jsonb_build_object('colores',btrim(b->>'colors')),coalesce(btrim(b->>'notes'),''),selections) returning id into oid;
 for selection in select value from jsonb_array_elements(selections) loop
  if coalesce(btrim(selection->>'pantone'),'')<>'' then insert into public.prisma_pantone_requests(order_id,slot,pantone) values(oid,(selection->>'slot')::integer,btrim(selection->>'pantone'));end if;
 end loop;
 insert into public.prisma_order_portal_submissions values(request_id,oid,signature);
 return jsonb_build_object('ok',true,'id',oid,'queue_number',n,'duplicate',false);
end $$;
create or replace function public.prisma_state() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.prisma_authorize();
 return jsonb_build_object('today',public.prisma_today(),'baseline',(select value from public.prisma_metadata where key='baseline'),
 'incidents',coalesce((select jsonb_agg((to_jsonb(r)-'before_photo'-'after_photo')||jsonb_build_object('has_before',coalesce(r.before_photo,'')<>'','has_after',coalesce(r.after_photo,'')<>'','elapsed_seconds',case when r.started_at is null then 0 else greatest(0,floor(extract(epoch from (coalesce(r.ended_at,now())-r.started_at)))) end,'folio','INC-'||lpad(r.incident_number::text,greatest(4,length(r.incident_number::text)),'0')) order by r.incident_number desc) from public.prisma_incidents r),'[]'::jsonb),
 'preparations',coalesce((select jsonb_agg(to_jsonb(r) order by r.date desc,r.start_time desc,r.id desc) from public.prisma_preparations r),'[]'::jsonb),
 'pantone_requests',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('ingredients',coalesce((select jsonb_agg(to_jsonb(x)) from (select i.*,p.name,p.code,l.lot from public.prisma_pantone_ingredients i join public.prisma_lots l on l.id=i.lot_id join public.prisma_products p on p.id=l.product_id where i.request_id=r.id)x),'[]'::jsonb)) order by r.id) from public.prisma_pantone_requests r),'[]'::jsonb),
 'products',coalesce((select jsonb_agg(to_jsonb(p) order by name) from public.prisma_products p),'[]'::jsonb),
 'lots',coalesce((select jsonb_agg(to_jsonb(x) order by x.name,x.entry_date) from (select l.*,p.name,p.code,p.kind,p.provider,p.category,p.minimum,p.maximum,p.container_grams from public.prisma_lots l join public.prisma_products p on p.id=l.product_id)x),'[]'::jsonb),
 'movements',coalesce((select jsonb_agg(to_jsonb(x) order by x.date desc,x.id desc) from (select m.*,p.name,p.code,l.lot from public.prisma_movements m join public.prisma_lots l on l.id=m.lot_id join public.prisma_products p on p.id=l.product_id)x),'[]'::jsonb),
 'orders',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('lines',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select i.*,p.name,p.code,l.lot from public.prisma_items i join public.prisma_lots l on l.id=i.lot_id join public.prisma_products p on p.id=l.product_id where i.order_id=o.id)x),'[]'::jsonb)) order by o.date desc,o.id desc) from public.prisma_orders o),'[]'::jsonb),
 'cuts',coalesce((select jsonb_agg(to_jsonb(c) order by month desc) from public.prisma_cuts c),'[]'::jsonb));
end $$;
create or replace function public.prisma_order_clock(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.prisma_orders%rowtype;op text:=payload->>'operation';stamp timestamptz;
begin
 perform public.prisma_authorize();perform pg_advisory_xact_lock(104202611);
 select * into r from public.prisma_orders where id=(payload->>'id')::bigint for update;
 if not found or r.status='cancelled' then raise exception 'Orden no encontrada o cancelada.';end if;
 stamp:=clock_timestamp();
 if op='start' then
  if r.ended_at is not null then raise exception 'La orden ya finalizó.';end if;
  update public.prisma_orders set started_at=coalesce(started_at,stamp) where id=r.id returning * into r;
 elsif op='finish' then
  if exists(select 1 from public.prisma_pantone_requests where order_id=r.id and status='pending') then raise exception 'Completa las solicitudes de Pantone antes de finalizar la preparación.';end if;
  if r.started_at is null then raise exception 'Primero inicia la orden.';end if;
  update public.prisma_orders set ended_at=coalesce(ended_at,stamp) where id=r.id returning * into r;
 else raise exception 'Acción de cronómetro no válida.';end if;
 return jsonb_build_object('id',r.id,'started_at',r.started_at,'ended_at',r.ended_at);
end $$;
create or replace function public.prisma_complete_pantone(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
<<mix>>
declare r public.prisma_pantone_requests%rowtype;o public.prisma_orders%rowtype;item jsonb;ingredient record;l public.prisma_lots%rowtype;output numeric;total_input numeric:=0;total_cost numeric:=0;amount numeric;d date;pid bigint;lid bigint;code_value text;
begin
 perform public.prisma_authorize();perform pg_advisory_xact_lock(104202611);
 select * into r from public.prisma_pantone_requests where id=(payload->>'id')::bigint for update;if not found then raise exception 'Solicitud no encontrada.';end if;
 if r.status='completed' then return jsonb_build_object('id',r.id,'output_lot_id',r.output_lot_id);end if;
 select * into o from public.prisma_orders where id=r.order_id;if o.status='cancelled' then raise exception 'La orden está cancelada.';end if;
 d:=public.prisma_date(public.prisma_today()::text);output:=round(public.prisma_number(payload->>'kilograms','Kilos preparados',0.000001)*1000,3);
 if jsonb_typeof(payload->'ingredients') is distinct from 'array' or jsonb_array_length(payload->'ingredients') not between 1 and 100 then raise exception 'Agrega las tintas utilizadas.';end if;
 for ingredient in select (v->>'lot_id')::bigint as lot_id,sum(round(public.prisma_number(v->>'kilograms','Kilos de tinta',0.000001)*1000,3)) as grams from jsonb_array_elements(payload->'ingredients')v group by (v->>'lot_id')::bigint loop
  select pl.* into l from public.prisma_lots pl join public.prisma_products p on p.id=pl.product_id where pl.id=ingredient.lot_id and p.category='tinta' for update of pl;
  if not found or ingredient.grams<=0 or l.grams<ingredient.grams then raise exception 'Existencia insuficiente en un ingrediente.';end if;
  total_input:=total_input+ingredient.grams;total_cost:=total_cost+ingredient.grams*l.cost_kg/1000;
 end loop;
 if output<=0 or output>total_input then raise exception 'Los kilos preparados no pueden superar la suma de ingredientes.';end if;
 code_value:='MIX-PANTONE-'||r.id;
 insert into public.prisma_products(code,name,kind,provider,category,minimum,cost_kg) values(code_value,'Pantone '||r.pantone,'Mezcla','Preparación interna','tinta',0,total_cost/(output/1000)) returning id into pid;
 insert into public.prisma_lots(product_id,lot,entry_date,shelf_days,cost_kg,grams) values(pid,'MIX-'||r.id||'-'||d,d,365,total_cost/(output/1000),output) returning id into lid;
 for ingredient in select (v->>'lot_id')::bigint as lot_id,sum(round(public.prisma_number(v->>'kilograms','Kilos de tinta',0.000001)*1000,3)) as grams from jsonb_array_elements(payload->'ingredients')v group by (v->>'lot_id')::bigint loop
  select * into l from public.prisma_lots where id=ingredient.lot_id;
  update public.prisma_lots set grams=grams-ingredient.grams where id=l.id;
  insert into public.prisma_pantone_ingredients(request_id,lot_id,grams,cost_kg) values(r.id,l.id,ingredient.grams,l.cost_kg);
  insert into public.prisma_movements(lot_id,type,grams,cost_kg,date,reason) values(l.id,'out',ingredient.grams,l.cost_kg,d,'Preparación Pantone '||r.pantone||' · '||o.folio);
 end loop;
 insert into public.prisma_movements(lot_id,type,grams,cost_kg,date,reason) values(lid,'in',output,total_cost/(output/1000),d,'Mezcla Pantone '||r.pantone||' · '||o.folio);
 update public.prisma_pantone_requests set status='completed',prepared_at=clock_timestamp(),output_grams=output,output_lot_id=lid where id=r.id;
 return jsonb_build_object('id',r.id,'output_lot_id',lid);
end $$;
revoke all on function public.prisma_complete_pantone(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_complete_pantone(jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
