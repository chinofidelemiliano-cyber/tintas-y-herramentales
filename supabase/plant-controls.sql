begin;

create table if not exists public.prisma_plant_catalog(
 kind text not null check(kind in ('part','anilox','recipe','die')),
 code text not null check(length(code) between 1 and 100),
 details jsonb not null check(jsonb_typeof(details)='object'),
 updated_at timestamptz not null default now(),
 primary key(kind,code)
);
create table if not exists public.prisma_order_plant_recipes(
 order_id bigint primary key references public.prisma_orders(id),
 recipe_key text not null,
 template jsonb,
 attached_at timestamptz not null default now()
);
alter table public.prisma_order_plant_recipes enable row level security;
revoke all on public.prisma_order_plant_recipes from public,anon,authenticated;
create table if not exists public.prisma_ink_planning(
 product_id bigint primary key references public.prisma_products(id),
 category text check(category in ('A','B','C')),
 indispensable boolean not null default false,
 lead_days integer not null default 7 check(lead_days between 1 and 365),
 review_days integer not null default 14 check(review_days between 1 and 365),
 safety_days integer not null default 3 check(safety_days between 0 and 365),
 ordered_at timestamptz
);
create table if not exists public.prisma_ink_parameters(
 id bigint generated always as identity primary key,
 product_id bigint not null references public.prisma_products(id),
 lot_id bigint references public.prisma_lots(id),
 viscosity numeric check(viscosity>0),
 viscosity_unit text,
 ph numeric check(ph between 0 and 14),
 drying text,
 note text,
 actor uuid not null references auth.users(id),
 recorded_at timestamptz not null default now()
);
create index if not exists prisma_ink_parameters_product_date on public.prisma_ink_parameters(product_id,recorded_at desc);
create table if not exists public.prisma_tool_services(
 id bigint generated always as identity primary key,
 batch_id uuid,
 kind text not null check(kind in ('die','anilox')),
 code text not null,
 service text not null check(service in ('maintenance','audit','resharpen')),
 due_on date not null,
 sent_on date,
 received_on date,
 snapshot jsonb not null default '{}',
 receipt jsonb,
 actor uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
alter table public.prisma_tool_services add column if not exists batch_id uuid;
create index if not exists prisma_tool_services_kind_code on public.prisma_tool_services(kind,code,id);
create unique index if not exists prisma_open_die_resharpen on public.prisma_tool_services(code)
 where kind='die' and service='resharpen' and received_on is null;
create unique index if not exists prisma_open_scheduled_tool_service
 on public.prisma_tool_services(kind,code,service,due_on) where service<>'resharpen' and received_on is null;
alter table public.prisma_plant_catalog enable row level security;
alter table public.prisma_ink_planning enable row level security;
alter table public.prisma_ink_parameters enable row level security;
alter table public.prisma_tool_services enable row level security;
revoke all on public.prisma_plant_catalog,public.prisma_ink_planning,public.prisma_ink_parameters,public.prisma_tool_services from public,anon,authenticated;

create or replace function public.prisma_plant_recipe_key(np text, product text) returns text
language sql stable set search_path=public,pg_temp as $$
 with normalized as (select upper(trim(np)) code), selected as (
  select case when n.code ~ '^[0-9]{3}-[0-9]+$' and exists(
   select 1 from public.prisma_plant_catalog c where c.kind='part' and c.code='NP'||n.code) then 'NP'||n.code else n.code end code
  from normalized n
 )
 select case when coalesce(jsonb_array_length(c.details->'names'),0)<=1 then s.code
  when exists(select 1 from jsonb_array_elements_text(c.details->'names') name
   where upper(trim(name))=upper(trim(product))) then s.code||'/'||md5(upper(trim(product)))
  else null end
 from selected s left join public.prisma_plant_catalog c on c.kind='part' and c.code=s.code;
$$;
revoke all on function public.prisma_plant_recipe_key(text,text) from public,anon,authenticated;

-- Only confirmed order lines represent the ink consumed on a run. Reversed orders are excluded.
create or replace function public.prisma_plant_ink_consumption(since date) returns table(
 order_id bigint, np text, product_id bigint, grams numeric, meters numeric, day date
) language sql stable set search_path=public,pg_temp as $$
 select o.id,upper(trim(coalesce(nullif(i.np,''),o.np,''))),l.product_id,
  sum(i.grams),case when count(distinct i.meters)=1 then max(i.meters) end,o.date
 from public.prisma_orders o join public.prisma_items i on i.order_id=o.id
 join public.prisma_lots l on l.id=i.lot_id join public.prisma_products p on p.id=l.product_id
 where o.status='confirmed' and o.date>=since and p.category='tinta' and i.grams>=0
 group by 1,2,3,6;
$$;
revoke all on function public.prisma_plant_ink_consumption(date) from public,anon,authenticated;

create or replace function public.prisma_plant_history_days(reference_day date) returns integer
language sql stable set search_path=public,pg_temp as $$
 select greatest(1,least(90,reference_day-coalesce((select value::date from public.prisma_metadata where key='baseline'),reference_day-89)+1));
$$;
revoke all on function public.prisma_plant_history_days(date) from public,anon,authenticated;

create or replace function public.prisma_plant_ink_demand(since date) returns table(product_id bigint, grams numeric)
language sql stable set search_path=public,pg_temp as $$
 select entries.product_id,sum(entries.grams) from (
  select c.product_id,c.grams from public.prisma_plant_ink_consumption(since) c
  union all
  select l.product_id,m.grams from public.prisma_movements m join public.prisma_lots l on l.id=m.lot_id
   join public.prisma_products p on p.id=l.product_id
   where m.date>=since and m.type='out' and m.order_id is null and m.reason like 'Preparación Pantone %' and p.category='tinta'
 ) entries group by entries.product_id;
$$;
revoke all on function public.prisma_plant_ink_demand(date) from public,anon,authenticated;

create or replace function public.prisma_plant_tools() returns jsonb
language sql stable set search_path=public,pg_temp as $$
 with runs as (
  select o.id,o.date,upper(coalesce(p.code,substring(o.specifications->>'suaje' from '(SJ[[:alnum:]-]+)'))) code,
   coalesce((o.specifications->>'actual_cut_meters')::numeric,(select
    case when count(distinct meters)=1 then max(meters) end from public.prisma_items where order_id=o.id)) meters
  from public.prisma_orders o left join public.prisma_products p on p.id=nullif(o.specifications->>'die_id','')::bigint
  where o.status='confirmed'
 ), cycles as (
  select code,count(*)::int count,max(received_on) last_received
  from public.prisma_tool_services where kind='die' and service='resharpen' and received_on is not null group by code
 )
 select coalesce(jsonb_agg(to_jsonb(d) order by d.code),'[]') from (
  select p.id,p.code,p.name,p.tooling_details||coalesce(c.details,'{}') details,
   coalesce(cyc.count,0)+coalesce((c.details->>'initial_regrinds')::int,0) regrinds,
   coalesce(sum(r.meters) filter(where r.date>coalesce(cyc.last_received,(c.details->>'initial_cycle_date')::date,'-infinity'::date)),0)
    +case when cyc.last_received is null then coalesce((c.details->>'initial_cycle_meters')::numeric,0) else 0 end cycle_meters
  from public.prisma_products p left join public.prisma_plant_catalog c on c.kind='die' and c.code=p.code
  left join cycles cyc on cyc.code=p.code left join runs r on r.code=upper(p.code)
  where p.category='herramental' and p.code like 'SJ%'
  group by p.id,c.details,cyc.count,cyc.last_received
 ) d;
$$;
revoke all on function public.prisma_plant_tools() from public,anon,authenticated;

create or replace function public.prisma_plant_controls(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
<<request>>
declare
 op text:=payload->>'operation';
 kind text:=payload->>'kind';
 code text:=upper(trim(coalesce(payload->>'code','')));
 details jsonb:=payload->'details';
 quantity numeric;
 product public.prisma_products%rowtype;
 id_value bigint;
 result jsonb;
 item jsonb;
 service public.prisma_tool_services%rowtype;
 service_type text:=payload->>'service';
 today date:=public.prisma_today();
 days integer;
 point date;
 ids jsonb;
 batch uuid;
 recipe_key text;
 variant text:=nullif(trim(payload->>'product'),'');
 tool_snapshots jsonb;
begin
 if op in ('ink_list','ink_history','forecast','ink_settings','ink_ordered','ink_measure') then
  perform public.prisma_require_permission('inventory');
 else
  perform public.prisma_require_permission('production');
 end if;
 if op='ink_list' then
  days:=public.prisma_plant_history_days(today);
  with consumption as (
   select d.product_id,d.grams from public.prisma_plant_ink_demand(today-(days-1)) d
  ), inventory as (
   select product_id,sum(grams) grams from public.prisma_lots group by product_id
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.consumed desc,x.code),'[]') into result from (
   select p.id,p.code,p.name,p.kind,coalesce(c.grams,0) consumed,coalesce(i.grams,0) on_hand,
    s.category,s.ordered_at,coalesce(s.indispensable,false) indispensable,coalesce(s.lead_days,7) lead_days,
    coalesce(s.review_days,14) review_days,coalesce(s.safety_days,3) safety_days
   from public.prisma_products p left join consumption c on c.product_id=p.id left join inventory i on i.product_id=p.id
   left join public.prisma_ink_planning s on s.product_id=p.id where p.category='tinta'
  ) x;
  return jsonb_build_object('days',days,'inks',result,'today',today);
 end if;
 if op='forecast' then
  quantity:=(payload->>'meters')::numeric;
  if code='' or quantity is null or quantity<=0 or quantity>1e9 or quantity::text in ('NaN','Infinity') then
   raise exception 'Captura el NP y el metraje previsto.';end if;
  if code ~ '^[0-9]{3}-[0-9]+$' and exists(select 1 from public.prisma_plant_catalog c where c.kind='part' and c.code='NP'||request.code) then code:='NP'||code;end if;
  recipe_key:=public.prisma_plant_recipe_key(code,variant);
  if recipe_key is null then raise exception 'El catálogo tiene varios productos para ese NP. Captura el nombre exacto del producto.';end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]') into result from (
   select p.code,p.name,count(*) orders,sum(c.meters) historical_meters,sum(c.grams) historical_grams,
    round(quantity*sum(c.grams)/sum(c.meters),2) estimated_grams
   from public.prisma_plant_ink_consumption('-infinity') c join public.prisma_products p on p.id=c.product_id
   join public.prisma_orders o on o.id=c.order_id
   where (position('/' in recipe_key)=0 or upper(trim(o.product))=upper(variant)) and (c.np=request.code or (request.code ~ '^NP[0-9]{3}-[0-9]+$' and c.np=substring(request.code from 3))) and c.meters>0 group by p.code,p.name
  ) x;
  return jsonb_build_object('estimates',result);
 end if;
 if op in ('ink_history','ink_settings','ink_ordered','ink_measure') then
  select * into product from public.prisma_products where id=(payload->>'id')::bigint and category='tinta';
  if not found then raise exception 'Tinta no encontrada.';end if;
  if op='ink_history' then
   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
    select c.day,o.folio,c.np,c.grams,c.meters from public.prisma_plant_ink_consumption('-infinity') c
    join public.prisma_orders o on o.id=c.order_id where c.product_id=product.id order by c.day desc,c.order_id desc limit 100
   ) x;
   return jsonb_build_object('consumption',result,'mixtures',(select coalesce(jsonb_agg(to_jsonb(outflow)),'[]') from (
    select m.date,m.grams,m.reason from public.prisma_movements m join public.prisma_lots l on l.id=m.lot_id
    where l.product_id=product.id and m.type='out' and m.order_id is null and m.reason like 'Preparación Pantone %'
    order by m.date desc,m.id desc limit 100
   ) outflow),'other_outflows',(select coalesce(jsonb_agg(to_jsonb(outflow)),'[]') from (
    select m.date,m.grams,m.reason from public.prisma_movements m join public.prisma_lots l on l.id=m.lot_id
    where l.product_id=product.id and m.type='out' and m.order_id is null and m.reason not like 'Preparación Pantone %'
    order by m.date desc,m.id desc limit 100
   ) outflow),'parameters',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (
    select m.*,l.lot from public.prisma_ink_parameters m left join public.prisma_lots l on l.id=m.lot_id
    where m.product_id=product.id order by m.id desc limit 100
   ) t));
  end if;
  perform public.prisma_require_permission('catalog');
  if op='ink_settings' then
   insert into public.prisma_ink_planning(product_id,category,indispensable,lead_days,review_days,safety_days)
   values(product.id,nullif(payload->>'category',''),coalesce((payload->>'indispensable')::boolean,false),
    (payload->>'lead_days')::int,(payload->>'review_days')::int,(payload->>'safety_days')::int)
   on conflict(product_id) do update set category=excluded.category,indispensable=excluded.indispensable,
    lead_days=excluded.lead_days,review_days=excluded.review_days,safety_days=excluded.safety_days;
  elsif op='ink_ordered' then
   insert into public.prisma_ink_planning(product_id,ordered_at) values(product.id,case when payload->>'ordered'='true' then now() end)
   on conflict(product_id) do update set ordered_at=excluded.ordered_at;
  else
   id_value:=nullif(payload->>'lot_id','')::bigint;
   if id_value is not null and not exists(select 1 from public.prisma_lots where id=id_value and product_id=product.id) then raise exception 'El lote no corresponde a esta tinta.';end if;
   if coalesce(nullif(payload->>'viscosity',''),nullif(payload->>'ph',''),nullif(trim(payload->>'drying'),'')) is null then raise exception 'Registra al menos un parámetro.';end if;
   if (nullif(payload->>'viscosity','') is not null and payload->>'viscosity' !~ '^[0-9]{1,8}([.][0-9]{1,6})?$')
    or (nullif(payload->>'ph','') is not null and payload->>'ph' !~ '^[0-9]{1,2}([.][0-9]{1,6})?$') then
    raise exception 'Captura valores numéricos válidos.';
   end if;
   if nullif(payload->>'viscosity','') is not null and coalesce(trim(payload->>'viscosity_unit'),'')='' then raise exception 'Indica la unidad de viscosidad.';end if;
   if length(coalesce(payload->>'drying',''))>200 or length(coalesce(payload->>'note',''))>1000 or length(coalesce(payload->>'viscosity_unit',''))>30 then raise exception 'El parámetro o la nota exceden su longitud.';end if;
   insert into public.prisma_ink_parameters(product_id,lot_id,viscosity,viscosity_unit,ph,drying,note,actor)
   values(product.id,id_value,nullif(payload->>'viscosity','')::numeric,nullif(trim(payload->>'viscosity_unit'),''),
    nullif(payload->>'ph','')::numeric,nullif(trim(payload->>'drying'),''),nullif(trim(payload->>'note'),''),auth.uid());
  end if;
  return jsonb_build_object('ok',true);
 end if;
 if op='tools' then
  return jsonb_build_object('dies',public.prisma_plant_tools(),'anilox',(select coalesce(jsonb_agg(c.details||jsonb_build_object('code',c.code) order by substring(c.code from 3)::int),'[]') from public.prisma_plant_catalog c where c.kind='anilox'),
   'services',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id desc),'[]') from public.prisma_tool_services s),'today',today);
 end if;
 if op='parts' then
  return jsonb_build_object('parts',(select coalesce(jsonb_agg(c.details||jsonb_build_object('code',c.code) order by c.code),'[]') from public.prisma_plant_catalog c where c.kind='part'));
 end if;
 if op='recipe' then
  if payload ? 'order_id' then
   select jsonb_build_object('id',o.id,'folio',o.folio,'np',o.np,'product',o.product,'machine',o.machine,'pressman',o.pressman,
    'specifications',o.specifications,'inks',coalesce((select jsonb_agg(j||jsonb_build_object('name',p.name)) from jsonb_array_elements(o.ink_selections) j
      left join public.prisma_products p on p.id=(j->>'product_id')::bigint),'[]')) into item from public.prisma_orders o where o.id=(payload->>'order_id')::bigint;
   if not found then raise exception 'Orden no encontrada.';end if;
   variant:=item->>'product';
   code:=upper(trim(coalesce(item->>'np','')));
   if code ~ '^[0-9]{3}-[0-9]+$' and exists(select 1 from public.prisma_plant_catalog c where c.kind='part' and c.code='NP'||request.code) then
    code:='NP'||code;
   end if;
  end if;
  recipe_key:=public.prisma_plant_recipe_key(code,variant);
  if recipe_key is null then raise exception 'Este NP identifica productos distintos en el catálogo. Captura el nombre exacto del producto.';end if;
  return jsonb_build_object('code',code,'product',variant,'order',item,'recipe',coalesce(
   (select r.template from public.prisma_order_plant_recipes r where r.order_id=(item->>'id')::bigint and r.recipe_key=request.recipe_key),
   (select c.details from public.prisma_plant_catalog c where c.kind='recipe' and c.code=request.recipe_key)),
   'anilox',(select coalesce(jsonb_agg(c.details||jsonb_build_object('code',c.code) order by substring(c.code from 3)::int),'[]') from public.prisma_plant_catalog c where c.kind='anilox'));
 end if;
 perform public.prisma_require_permission('preparation_edit');
 perform pg_advisory_xact_lock(104202611);
 if op='save_catalog' then
  if kind not in ('die','anilox','recipe') or code='' or jsonb_typeof(details) is distinct from 'object' or octet_length(details::text)>30000 then raise exception 'Revisa los datos del catálogo.';end if;
  if kind='die' then
   if not exists(select 1 from public.prisma_products p where p.category='herramental' and p.code=request.code and p.code like 'SJ%') then raise exception 'Suaje no encontrado.';end if;
   if coalesce((details->>'initial_regrinds')::int,0) not between 0 and 6 or coalesce((details->>'initial_cycle_meters')::numeric,0)<0 then raise exception 'Revisa los reafilados y metros iniciales.';end if;
   if coalesce((details->>'initial_regrinds')::int,0)+(select count(*) from public.prisma_tool_services s where s.code=request.code and s.kind='die' and s.service='resharpen')>6 then raise exception 'El total no puede superar seis reafilados.';end if;
  elsif kind='anilox' then
   if code !~ '^AX[1-9][0-9]{0,5}$' or coalesce((details->>'lpi')::numeric,0)<=0 or coalesce((details->>'bcm')::numeric,0)<=0 then raise exception 'Revisa código AX, lineaje y BCM.';end if;
  elsif jsonb_typeof(details->'stations') is distinct from 'array' or jsonb_array_length(details->'stations')>12 then raise exception 'Revisa las estaciones de la receta.';end if;
  if kind='recipe' then
   recipe_key:=public.prisma_plant_recipe_key(code,variant);
   if recipe_key is null then raise exception 'Este NP es ambiguo en el catálogo.';end if;
   if payload ? 'order_id' then
    select to_jsonb(public.prisma_plant_recipe_key(o.np,o.product)) into result from public.prisma_orders o where o.id=(payload->>'order_id')::bigint;
    if result is null or result#>>'{}' is distinct from recipe_key then raise exception 'La receta no corresponde a la orden.';end if;
    insert into public.prisma_order_plant_recipes(order_id,recipe_key,template)
     values((payload->>'order_id')::bigint,recipe_key,details)
     on conflict(order_id) do update set recipe_key=excluded.recipe_key,template=excluded.template;
   end if;
   code:=recipe_key;
  end if;
  insert into public.prisma_plant_catalog(kind,code,details) values(kind,code,details)
  on conflict on constraint prisma_plant_catalog_pkey do update set details=excluded.details,updated_at=now();
  return jsonb_build_object('ok',true);
 end if;
 if op='service_batch' then
  if kind not in ('die','anilox') or service_type not in ('maintenance','audit','resharpen') or (service_type='resharpen' and kind<>'die') then raise exception 'Servicio no válido.';end if;
  point:=(payload->>'due_on')::date;
  if point is null then raise exception 'Captura la fecha.';end if;
  ids:=payload->'codes';
  if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids) not between 1 and 40 then raise exception 'Selecciona de uno a cuarenta herramentales.';end if;
  if length(coalesce(payload->>'deliverer',''))>200 or length(coalesce(payload->>'recipient',''))>200 then raise exception 'Revisa los nombres de entrega y recepción.'; end if;
  batch:=gen_random_uuid();
  if kind='die' then tool_snapshots:=public.prisma_plant_tools();end if;
  result:='[]';
  for item in select distinct value from jsonb_array_elements(ids) loop
   code:=item#>>'{}';
   if kind='die' then
    select j into details from jsonb_array_elements(tool_snapshots) j where j->>'code'=code;
   else
    select c.details||jsonb_build_object('code',c.code) into details from public.prisma_plant_catalog c where c.kind='anilox' and c.code=request.code;
   end if;
   if not found then raise exception 'No existe el herramental %.',code;end if;
   if service_type='resharpen' and ((details->>'regrinds')::int>=6 or point>today) then raise exception 'El suaje % llegó a seis reafilados o la fecha de salida es futura.',code;end if;
   if service_type='resharpen' and (coalesce(trim(payload->>'deliverer'),'')='' or coalesce(trim(payload->>'recipient'),'')='') then raise exception 'Captura quién entrega y quién recibe.';end if;
   insert into public.prisma_tool_services(batch_id,kind,code,service,due_on,sent_on,snapshot,actor)
   values(batch,kind,code,service_type,point,case when service_type='resharpen' then point end,details||jsonb_build_object('deliverer',payload->>'deliverer','recipient',payload->>'recipient'),auth.uid())
   returning * into service;
   result:=result||jsonb_build_array(to_jsonb(service));
  end loop;
  return jsonb_build_object('services',result);
 end if;
 if op='complete_service' then
  select * into service from public.prisma_tool_services s where s.id=(payload->>'id')::bigint for update;
  if not found or service.received_on is not null then raise exception 'Servicio cerrado o no encontrado.';end if;
  point:=(payload->>'received_on')::date;
  if point is null or point>today or (service.sent_on is not null and point<service.sent_on) then raise exception 'Fecha de recepción no válida.';end if;
  if coalesce(trim(payload->>'received_by'),'')='' or length(payload->>'received_by')>200 or length(coalesce(payload->>'notes',''))>1000 then
   raise exception 'Revisa quién recibe y las observaciones.';
  end if;
  if service.service='resharpen' then
   if coalesce((select (c.details->>'initial_regrinds')::int from public.prisma_plant_catalog c where c.kind='die' and c.code=service.code),0)
    +(select count(*) from public.prisma_tool_services previous where previous.kind='die' and previous.code=service.code and previous.service='resharpen' and previous.received_on is not null)>=6 then
    raise exception 'Este suaje ya llegó al límite de seis reafilados.';
   end if;
   if coalesce(payload->>'passes','') not in ('yes','no') or coalesce(payload->>'gear','') not in ('yes','no') or coalesce(trim(payload->>'material'),'')='' then raise exception 'Completa el checklist de recepción.';end if;
  end if;
  update public.prisma_tool_services set received_on=point,receipt=jsonb_build_object('gear',payload->>'gear','passes',payload->>'passes','material',payload->>'material','notes',payload->>'notes','received_by',payload->>'received_by') where id=service.id;
  return jsonb_build_object('ok',true);
 end if;
 raise exception 'Acción no permitida.';
end $$;
revoke all on function public.prisma_plant_controls(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_plant_controls(jsonb) to authenticated;
do $$
begin
 if to_regprocedure('public.prisma_plant_portal_internal(text,jsonb)') is null then
  alter function public.prisma_order_portal(text,jsonb) rename to prisma_plant_portal_internal;
 end if;
end $$;
revoke all on function public.prisma_plant_portal_internal(text,jsonb) from public,anon,authenticated;
create or replace function public.prisma_order_portal(access_key text,payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; recipe_key text; target bigint; attached jsonb;
begin
 result:=public.prisma_plant_portal_internal(access_key,payload);
 if payload->>'operation'='catalog' then
  result:=result||jsonb_build_object('parts',(
   select coalesce(jsonb_agg(details||jsonb_build_object('code',code) order by code),'[]')
   from public.prisma_plant_catalog where kind='part'));
 elsif payload->>'operation'='submit' then
  target:=(result->>'id')::bigint;
  select public.prisma_plant_recipe_key(o.np,o.product) into recipe_key from public.prisma_orders o where o.id=target;
  if recipe_key is not null and recipe_key<>'' and not coalesce((result->>'duplicate')::boolean,false) then
   select c.details into attached from public.prisma_plant_catalog c where c.kind='recipe' and c.code=recipe_key;
   insert into public.prisma_order_plant_recipes(order_id,recipe_key,template) values(target,recipe_key,attached) on conflict(order_id) do nothing;
  end if;
  result:=result||jsonb_build_object('recipe_ready',exists(select 1 from public.prisma_order_plant_recipes r where r.order_id=target and r.template is not null));
 end if;
 return result;
end $$;
revoke all on function public.prisma_order_portal(text,jsonb) from public,anon,authenticated;
grant execute on function public.prisma_order_portal(text,jsonb) to authenticated,anon;
notify pgrst,'reload schema';
commit;
