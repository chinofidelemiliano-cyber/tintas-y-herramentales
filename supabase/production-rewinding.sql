-- Flujo por bobinas. Aplicar después de press-sheets.sql en instalaciones anteriores.
begin;
create table if not exists public.prisma_press_queues(profile_id uuid primary key references auth.users(id),production_key text not null unique default ('pq_'||encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex')),rewind_key text not null unique default ('rq_'||encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex')));
alter table public.prisma_press_queues enable row level security;
revoke all on public.prisma_press_queues from public,anon,authenticated;
alter table public.prisma_press_sheets add column if not exists rewind_key text;
alter table public.prisma_press_sheets add column if not exists bobinas jsonb not null default '[]';
create unique index if not exists prisma_press_rewind_key on public.prisma_press_sheets(rewind_key);
create or replace function public.prisma_planned_bobinas(meters text) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare total numeric;n integer;begin total:=nullif(meters,'')::numeric;if total is null or total<=0 then return '[]';end if;if total::text in ('NaN','Infinity','-Infinity') or total>15000000 then raise exception 'Metraje fuera de rango.';end if;n:=ceil(total/1500);return (select jsonb_agg(jsonb_build_object('number',i,'planned_meters',least(1500,total-(i-1)*1500),'produced_at',null,'rewound_at',null) order by i) from generate_series(1,n) i);end $$;
revoke all on function public.prisma_planned_bobinas(text) from public,anon,authenticated;
update public.prisma_press_sheets set rewind_key='rw_'||encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex'),bobinas=public.prisma_planned_bobinas(source->>'planned_meters') where rewind_key is null;
create or replace function public.prisma_press_sheets(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.prisma_orders%rowtype;row_value public.prisma_press_sheets%rowtype;prefs jsonb;source_value jsonb;colors jsonb;zone text;headers jsonb;pending record;
begin
 perform public.prisma_authorize();if not public.prisma_has_permission(auth.uid(),'preparation') and not public.prisma_has_permission(auth.uid(),'production') then raise exception 'No tienes permiso para órdenes de prensista.';end if;
 if payload->>'operation'='list' then
  insert into public.prisma_press_queues(profile_id) values(auth.uid()) on conflict do nothing;
  if exists(select 1 from public.prisma_admins where user_id=auth.uid()) then
   perform pg_advisory_xact_lock(104202611);
   for pending in select legacy.id from public.prisma_orders legacy where legacy.status<>'cancelled' and (legacy.ended_at is not null or legacy.status='confirmed') and not exists(select 1 from public.prisma_press_sheets s where s.order_id=legacy.id) loop
    perform public.prisma_press_sheets(jsonb_build_object('operation','generate','order_id',pending.id));
   end loop;
  end if;
 return jsonb_build_object('workflow_version',2,'links',(select jsonb_build_object('production_key',production_key,'rewind_key',rewind_key) from public.prisma_press_queues where profile_id=auth.uid()),'sheets',coalesce((select jsonb_agg((to_jsonb(s)-'fields'-'source')||jsonb_build_object('source',s.source-'reportLogo'-'colors') order by s.id desc) from public.prisma_press_sheets s where s.profile_id=auth.uid()),'[]'::jsonb));end if;
 if payload->>'operation' is distinct from 'generate' then raise exception 'Acción no válida.';end if;
 perform pg_advisory_xact_lock(104202611);select * into o from public.prisma_orders where id=(payload->>'order_id')::bigint;
 if not found or (o.ended_at is null and o.status<>'confirmed') or o.status='cancelled' then raise exception 'Primero finaliza la preparación de la orden.';end if;
 select * into row_value from public.prisma_press_sheets where order_id=o.id;
 if found then if row_value.profile_id<>auth.uid() then raise exception 'La hoja ya está guardada en el perfil de quien finalizó la preparación.';end if;return to_jsonb(row_value);end if;
 select preferences into prefs from public.prisma_user_preferences where user_id=auth.uid();prefs:=coalesce(prefs,'{}'::jsonb);
 headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;zone:=substring(headers->>'x-client-info' from 'time-zone=([^; ]+)');if zone is null or not exists(select 1 from pg_timezone_names where name=zone) then zone:=coalesce(prefs->>'timeZone','America/Mexico_City');end if;
 select coalesce(jsonb_agg(jsonb_build_object('slot',i.value->'slot','name',case when coalesce(i.value->>'pantone','')<>'' then 'Pantone '||(i.value->>'pantone') else coalesce(p.name,'') end,'code',coalesce(p.code,''),'family',coalesce(i.value->>'ink_family',o.specifications->>'tipo_tinta','')) order by (i.value->>'slot')::integer),'[]'::jsonb) into colors from jsonb_array_elements(o.ink_selections) i left join public.prisma_products p on p.id=nullif(i.value->>'product_id','')::bigint;
 if colors='[]'::jsonb then
  if coalesce(o.specifications->>'colores','')<>'' then colors:=jsonb_build_array(jsonb_build_object('slot',1,'name',o.specifications->>'colores','code','','family',coalesce(o.specifications->>'tipo_tinta','')));
  else select coalesce(jsonb_agg(jsonb_build_object('slot',ink.slot,'name',ink.name,'code',ink.code,'family',ink.kind)),'[]'::jsonb) into colors from (select row_number() over(order by p.code) as slot,p.name,p.code,p.kind from public.prisma_items item join public.prisma_lots l on l.id=item.lot_id join public.prisma_products p on p.id=l.product_id where item.order_id=o.id group by p.name,p.code,p.kind) ink;end if;
 end if;
 source_value:=jsonb_build_object('folio',o.folio,'np',coalesce(nullif(o.np,''),(select string_agg(distinct np,', ') from public.prisma_items where order_id=o.id and np<>''),''),'product',coalesce(nullif(o.product,''),o.client,''),'client',o.client,'pressman',o.pressman,'machine',o.machine,'date',o.date,'required_date',o.scheduled_date,'planned_meters',coalesce(o.planned_meters,(select max(meters) from public.prisma_items where order_id=o.id)),'pieces',o.pieces,'started_at',o.started_at,'ended_at',o.ended_at,'suaje',coalesce(o.specifications->>'suaje',''),'pleca',coalesce(o.specifications->>'pleca',''),'colors',colors,'prepared_by',coalesce(prefs->>'reportName',''),'reportLogo',prefs->'reportLogo','time_settings',jsonb_build_object('timezoneMode','custom','timeZone',zone,'timeFormat',coalesce(prefs->>'timeFormat','24')));
 insert into public.prisma_press_sheets(order_id,profile_id,access_key,source) values(o.id,auth.uid(),'ps_'||encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex'),source_value) returning * into row_value;update public.prisma_press_sheets set rewind_key='rw_'||encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex'),bobinas=public.prisma_planned_bobinas(source->>'planned_meters') where id=row_value.id returning * into row_value;return to_jsonb(row_value);
end $$;

create or replace function public.prisma_press_sheet(access_key text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare row_value public.prisma_press_sheets%rowtype;cancelled boolean;stage text;key_name text;value jsonb;allowed text[];bobina jsonb;idx integer;done_field text;filtered jsonb;
begin
 if access_key is null or access_key !~ '^(ps|rw)_[a-f0-9]{64}$' then raise exception 'Enlace no autorizado.';end if;
 select * into row_value from public.prisma_press_sheets s where s.access_key=prisma_press_sheet.access_key or s.rewind_key=prisma_press_sheet.access_key for update;if not found then raise exception 'Enlace no autorizado.';end if;
 stage:=case when row_value.access_key=access_key then 'production' else 'rewind' end;
 allowed:=case when stage='production' then array['category','scrap_target','width_in','height_in','width_mm','height_mm','priority','lamination','material_surface','material_adhesive','material_liner','material_code','material_delivered','material_pending','bobina_1_reel','bobina_1_eur','bobina_1_des','bobina_1_lot','bobina_1_meters','bobina_2_reel','bobina_2_eur','bobina_2_des','bobina_2_lot','bobina_2_meters','bobina_3_reel','bobina_3_eur','bobina_3_des','bobina_3_lot','bobina_3_meters','bobina_4_reel','bobina_4_eur','bobina_4_des','bobina_4_lot','bobina_4_meters','bobina_5_reel','bobina_5_eur','bobina_5_des','bobina_5_lot','bobina_5_meters','die_quantity','die_identification','die_state_out','die_date_out','die_state_return','die_date_return','crease_quantity','crease_identification','crease_state_out','crease_date_out','crease_state_return','crease_date_return','setup_expected','setup_actual','production_expected','production_actual','meters_actual','production_speed','pressman','prepress_signature','press_signature','observations'] else array['labels_per_roll','core_diameter','outer_diameter','core_material','turns_machine_1','turns_machine_2','turns_machine_3','rewind_expected','rewind_actual','rewind_date','labels_min','labels_max','labels_finished','thousands_ship','thousands_received','rewind_signature','dispatch_signature','box_size','boxes','bag','rolls_per_box','packing_signature','registration_min','registration_max','waste_percent','production_percent','operations_signature','production_signature','quality_signature'] end;
 select status='cancelled' into cancelled from public.prisma_orders where id=row_value.order_id;
 if payload->>'operation' in ('save','complete_bobina') then
  if cancelled then raise exception 'La orden fue cancelada. Solo se puede consultar.';end if;
  if (payload->>'version')::integer is distinct from row_value.version then raise exception 'Otra persona actualizó el formato. Recarga antes de guardar.';end if;
  if stage='rewind' and not exists(select 1 from jsonb_array_elements(row_value.bobinas) b where b->>'produced_at' is not null) then raise exception 'Rebobinado estará disponible al terminar la primera bobina.';end if;
  if payload->>'operation'='save' then
   if jsonb_typeof(payload->'fields') is distinct from 'object' or octet_length((payload->'fields')::text)>50000 then raise exception 'Datos del formato no válidos.';end if;
   for key_name,value in select * from jsonb_each(payload->'fields') loop if not key_name=any(allowed) or jsonb_typeof(value)<>'string' or length(value#>>'{}')>(case when key_name='observations' then 2000 else 200 end) then raise exception 'Campo no permitido en esta etapa o demasiado largo.';end if;end loop;
   update public.prisma_press_sheets set fields=fields||(payload->'fields'),version=version+1,updated_at=now() where id=row_value.id returning * into row_value;
  else
   if coalesce(payload->>'number','') !~ '^[1-9][0-9]{0,4}$' then raise exception 'Bobina no válida.';end if;
   idx:=(payload->>'number')::integer-1;bobina:=row_value.bobinas->idx;if bobina is null then raise exception 'Bobina no válida.';end if;
   done_field:=case when stage='production' then 'produced_at' else 'rewound_at' end;
   if bobina->>done_field is null then
    if stage='production' and idx>0 and row_value.bobinas->(idx-1)->>'produced_at' is null then raise exception 'Termina primero la bobina anterior.';end if;
    if stage='rewind' and bobina->>'produced_at' is null then raise exception 'Primero termina la producción de esta bobina.';end if;
    update public.prisma_press_sheets set bobinas=jsonb_set(bobinas,array[idx::text,done_field],to_jsonb(now())),version=version+1,updated_at=now() where id=row_value.id returning * into row_value;
   end if;
  end if;
 elsif payload->>'operation' is distinct from 'get' then raise exception 'Acción no válida.';end if;
 select coalesce(jsonb_object_agg(entry.key,entry.value),'{}') into filtered from jsonb_each(row_value.fields) entry where entry.key=any(allowed);
 return (to_jsonb(row_value)-'profile_id'-'access_key'-'rewind_key'-'order_id'-'fields')||jsonb_build_object('fields',filtered,'cancelled',cancelled,'stage',stage,'rewind_ready',exists(select 1 from jsonb_array_elements(row_value.bobinas) b where b->>'produced_at' is not null));
end $$;
revoke all on function public.prisma_press_sheets(jsonb),public.prisma_press_sheet(text,jsonb) from public,anon,authenticated;
grant execute on function public.prisma_press_sheets(jsonb) to authenticated;
grant execute on function public.prisma_press_sheet(text,jsonb) to anon,authenticated;
create or replace function public.prisma_press_queue(access_key text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.prisma_press_queues%rowtype;stage text;result jsonb;
begin
 if access_key is null or access_key !~ '^(pq|rq)_[a-f0-9]{64}$' then raise exception 'Enlace no autorizado.';end if;
 select * into q from public.prisma_press_queues queue where queue.production_key=prisma_press_queue.access_key or queue.rewind_key=prisma_press_queue.access_key;if not found then raise exception 'Enlace no autorizado.';end if;
 stage:=case when q.production_key=access_key then 'production' else 'rewind' end;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'access_key',case when stage='production' then s.access_key else s.rewind_key end,'bobinas',s.bobinas,'source',jsonb_build_object('folio',s.source->'folio','np',s.source->'np','product',s.source->'product','machine',s.source->'machine','date',s.source->'date','planned_meters',s.source->'planned_meters')) order by s.id),'[]'::jsonb) into result from public.prisma_press_sheets s join public.prisma_orders o on o.id=s.order_id where s.profile_id=q.profile_id and o.status<>'cancelled' and (stage='production' or exists(select 1 from jsonb_array_elements(s.bobinas) b where b->>'produced_at' is not null));
 return jsonb_build_object('stage',stage,'sheets',result);
end $$;
revoke all on function public.prisma_press_queue(text) from public,anon,authenticated;
grant execute on function public.prisma_press_queue(text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
