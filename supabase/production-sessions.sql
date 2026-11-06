-- Ejecutar completo después de production-rewinding.sql. Conserva historial e inventario.
begin;
alter table public.prisma_press_sheets add column if not exists runtime jsonb not null default '{}';
-- Duración neta: une intervalos solapados para no descontar dos veces un paro.
create or replace function public.prisma_press_net_seconds(stops jsonb,started timestamptz,finished timestamptz) returns numeric language plpgsql set search_path=public,pg_temp as $$
declare span record;covered timestamptz:=started;paused numeric:=0;
begin
 if started is null or finished is null or finished<=started then return 0;end if;
 for span in select greatest(started,(j->>'started_at')::timestamptz) as a,least(finished,coalesce((j->>'ended_at')::timestamptz,finished)) as z from jsonb_array_elements(coalesce(stops,'[]')) j order by a loop
  if span.z>span.a then paused:=paused+greatest(0,extract(epoch from span.z-greatest(span.a,covered)));covered:=greatest(covered,span.z);end if;
 end loop;
 return greatest(0,extract(epoch from finished-started)-paused);
end $$;
create or replace function public.prisma_press_prepare(sheet_id bigint) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.prisma_press_sheets%rowtype;plan jsonb;total numeric;size numeric;rows jsonb;
begin
 select * into s from public.prisma_press_sheets where id=sheet_id for update;if not found then return;end if;
 select specifications->'production_plan' into plan from public.prisma_orders where id=s.order_id;
 if s.runtime->>'started_at' is null and not exists(select 1 from jsonb_array_elements(s.bobinas) b where b->>'produced_at' is not null) and plan is not null and plan is distinct from s.source->'production_plan' then
  total:=nullif(s.source->>'planned_meters','')::numeric;size:=coalesce((plan->>'reel_meters')::numeric,1500);
  if size<=0 or (total is not null and total/size>10000) then raise exception 'Revisa los metros por bobina (máximo 10,000 bobinas).';end if;
  select coalesce(jsonb_agg(jsonb_build_object('number',i,'planned_meters',least(size,total-(i-1)*size),'produced_at',null,'rewound_at',null) order by i),'[]') into rows from generate_series(1,coalesce(ceil(total/size)::integer,0)) i;
  update public.prisma_press_sheets set source=jsonb_set(source,'{production_plan}',plan),bobinas=rows,version=version+1 where id=s.id;
 end if;
end $$;
create or replace function public.prisma_sync_press_incidents(sheet_id bigint) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.prisma_press_sheets%rowtype;incident record;stops jsonb;entry jsonb;position integer;begin_at timestamptz;end_at timestamptz;updated jsonb;
begin
 select * into s from public.prisma_press_sheets where id=sheet_id for update;if not found or s.runtime->>'started_at' is null then return;end if;
 stops:=coalesce(s.runtime->'stops','[]');
 for incident in select * from public.prisma_incidents i where i.order_id=s.order_id and i.machine=s.source->>'machine' and i.impact='Paro' and i.started_at is not null loop
  begin_at:=greatest(incident.started_at,(s.runtime->>'started_at')::timestamptz);end_at:=incident.ended_at;
  if (end_at is not null and end_at<=begin_at) or (s.runtime->>'ended_at' is not null and begin_at>=(s.runtime->>'ended_at')::timestamptz) then continue;end if;
  if s.runtime->>'ended_at' is not null then end_at:=least(coalesce(end_at,(s.runtime->>'ended_at')::timestamptz),(s.runtime->>'ended_at')::timestamptz);end if;
  select ord::integer-1 into position from jsonb_array_elements(stops) with ordinality as stop(j,ord) where j->>'incident_id'=incident.id::text;
  if position is null then stops:=stops||jsonb_build_array(jsonb_build_object('id','incident-'||incident.id,'reason','incidencia','details','INC-'||lpad(incident.incident_number::text,greatest(4,length(incident.incident_number::text)),'0'),'incident_id',incident.id,'started_at',begin_at,'ended_at',end_at));
  elsif end_at is not null then stops:=jsonb_set(stops,array[position::text,'ended_at'],to_jsonb(end_at));end if;
 end loop;
 for entry,position in select j,ord::integer-1 from jsonb_array_elements(stops) with ordinality as stop(j,ord) where j->>'incident_id' is not null and j->>'ended_at' is null loop
  if not exists(select 1 from public.prisma_incidents i where i.id=(entry->>'incident_id')::bigint and i.order_id=s.order_id and i.machine=s.source->>'machine' and i.impact='Paro') then stops:=jsonb_set(stops,array[position::text,'ended_at'],to_jsonb(clock_timestamp()));end if;
 end loop;
 updated:=s.runtime||jsonb_build_object('stops',stops);if updated is distinct from s.runtime then update public.prisma_press_sheets set runtime=updated,version=version+1 where id=s.id;end if;
end $$;
create or replace function public.prisma_incident_press_trigger() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare s record;begin perform pg_advisory_xact_lock(104202611);for s in select id from public.prisma_press_sheets where order_id=new.order_id or (tg_op='UPDATE' and order_id=old.order_id) loop perform public.prisma_sync_press_incidents(s.id);end loop;return new;end $$;
drop trigger if exists prisma_incident_press_pause on public.prisma_incidents;
create trigger prisma_incident_press_pause after insert or update on public.prisma_incidents for each row execute function public.prisma_incident_press_trigger();
do $$begin
 if to_regprocedure('public.prisma_press_sheet_v2_internal(text,jsonb)') is null then alter function public.prisma_press_sheet(text,jsonb) rename to prisma_press_sheet_v2_internal;end if;
 if to_regprocedure('public.prisma_press_sheets_v2_internal(jsonb)') is null then alter function public.prisma_press_sheets(jsonb) rename to prisma_press_sheets_v2_internal;end if;
 if to_regprocedure('public.prisma_order_portal_plan_internal(text,jsonb)') is null then alter function public.prisma_order_portal(text,jsonb) rename to prisma_order_portal_plan_internal;end if;
 execute replace(pg_get_functiondef('public.prisma_press_sheet_v2_internal(text,jsonb)'::regprocedure),'prisma_press_sheet.access_key','prisma_press_sheet_v2_internal.access_key');
end $$;
revoke all on function public.prisma_press_sheet_v2_internal(text,jsonb),public.prisma_press_sheets_v2_internal(jsonb),public.prisma_order_portal_plan_internal(text,jsonb),public.prisma_press_prepare(bigint),public.prisma_sync_press_incidents(bigint),public.prisma_incident_press_trigger(),public.prisma_press_net_seconds(jsonb,timestamptz,timestamptz) from public,anon,authenticated;
create or replace function public.prisma_press_sheets(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;s record;sanitized jsonb;
begin
 result:=public.prisma_press_sheets_v2_internal(payload);
 if payload->>'operation'='list' then
  for s in select id from public.prisma_press_sheets where profile_id=auth.uid() loop perform public.prisma_press_prepare(s.id);end loop;
  select coalesce(jsonb_agg((to_jsonb(p)-'runtime'-'fields'-'source')||jsonb_build_object('source',p.source-'reportLogo'-'colors') order by p.id desc),'[]') into sanitized from public.prisma_press_sheets p where p.profile_id=auth.uid();
  return (result-'sheets')||jsonb_build_object('workflow_version',3,'sheets',sanitized);
 end if;
 perform public.prisma_press_prepare((result->>'id')::bigint);select to_jsonb(p)-'runtime' into result from public.prisma_press_sheets p where id=(result->>'id')::bigint;return result;
end $$;
create or replace function public.prisma_press_sheet(access_key text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.prisma_press_sheets%rowtype;o public.prisma_orders%rowtype;r jsonb;stops jsonb;rows jsonb;row_value jsonb;result jsonb;op text:=payload->>'operation';is_production boolean;at_time timestamptz:=clock_timestamp();idx integer;reason text;details text;actual numeric;active boolean;manual_idx integer;finished boolean;active_rows jsonb;seconds numeric;
begin
 if access_key is null or access_key !~ '^(ps|rw)_[a-f0-9]{64}$' then raise exception 'Enlace no autorizado.';end if;
 perform pg_advisory_xact_lock(104202611);select * into s from public.prisma_press_sheets p where p.access_key=prisma_press_sheet.access_key or p.rewind_key=prisma_press_sheet.access_key for update;if not found then raise exception 'Enlace no autorizado.';end if;
 perform public.prisma_press_prepare(s.id);perform public.prisma_sync_press_incidents(s.id);select * into s from public.prisma_press_sheets where id=s.id;
 select * into o from public.prisma_orders where id=s.order_id;is_production:=s.access_key=access_key;r:=s.runtime;stops:=coalesce(r->'stops','[]');rows:=s.bobinas;
 if op<>'get' and (o.status='cancelled' or (is_production and o.status='confirmed')) then raise exception 'La orden ya está cerrada o cancelada. Solo consulta.';end if;
 if is_production and op in ('start_production','start_bobina','complete_bobina','pause','resume') then
  if (payload->>'version')::integer is distinct from s.version then raise exception 'Otra persona actualizó el formato. Pulsa Actualizar.';end if;
  if r->>'ended_at' is not null or not exists(select 1 from jsonb_array_elements(rows) b where b->>'produced_at' is null) then raise exception 'La producción ya terminó.';end if;
  active:=exists(select 1 from jsonb_array_elements(stops) j where j->>'ended_at' is null);
  if op='start_production' then
   if exists(select 1 from public.prisma_press_sheets other join public.prisma_orders ord on ord.id=other.order_id where other.id<>s.id and other.source->>'machine'=s.source->>'machine' and other.runtime->>'started_at' is not null and other.runtime->>'ended_at' is null and ord.status not in ('confirmed','cancelled')) then raise exception 'Esta máquina tiene otra producción en curso.';end if;
   if r->>'started_at' is null then r:=r||jsonb_build_object('started_at',at_time);end if;
  else
   if r->>'started_at' is null then raise exception 'Primero inicia la producción.';end if;
   if op='pause' then
    if active then raise exception 'Ya hay un paro en curso.';end if;reason:=payload->>'reason';details:=btrim(coalesce(payload->>'details',''));
    if reason is null or reason not in ('baño','comida','otro') or length(details)>500 or (reason='otro' and details='') then raise exception 'Selecciona y explica el motivo del paro.';end if;
    stops:=stops||jsonb_build_array(jsonb_build_object('id','manual-'||gen_random_uuid(),'reason',reason,'details',details,'started_at',at_time,'ended_at',null));
   elsif op='resume' then
    select ord::integer-1 into manual_idx from jsonb_array_elements(stops) with ordinality as stop(j,ord) where j->>'ended_at' is null and j->>'reason'<>'incidencia' limit 1;
    if manual_idx is null then raise exception 'El paro se cierra desde la incidencia vinculada.';end if;stops:=jsonb_set(stops,array[manual_idx::text,'ended_at'],to_jsonb(at_time));
   else
    if active then raise exception 'La producción está en paro. Reanuda o cierra la incidencia.';end if;
    if coalesce(payload->>'number','') !~ '^[1-9][0-9]{0,4}$' then raise exception 'Bobina no válida.';end if;idx:=(payload->>'number')::integer-1;row_value:=rows->idx;
    if row_value is null then raise exception 'Bobina no válida.';end if;if row_value->>'produced_at' is not null then raise exception 'Esta bobina ya terminó.';end if;
    if idx>0 and rows->(idx-1)->>'produced_at' is null then raise exception 'Termina primero la bobina anterior.';end if;
    if op='start_bobina' then if row_value->>'started_at' is null then row_value:=row_value||jsonb_build_object('started_at',at_time);end if;
    else
     if row_value->>'started_at' is null then raise exception 'Primero inicia la bobina.';end if;
     if coalesce(payload->>'actual_meters','') !~ '^[0-9]+([.][0-9]+)?$' then raise exception 'Captura los metros reales de la bobina.';end if;actual:=(payload->>'actual_meters')::numeric;reason:=btrim(coalesce(payload->>'shortfall_reason',''));
     if actual>1e12 or length(reason)>1000 or (actual<(row_value->>'planned_meters')::numeric and reason='') then raise exception 'Explica por qué se produjeron menos metros en esta bobina.';end if;
     row_value:=row_value||jsonb_build_object('actual_meters',actual,'shortfall_reason',reason,'produced_at',at_time,'elapsed_seconds',public.prisma_press_net_seconds(stops,(row_value->>'started_at')::timestamptz,at_time));
    end if;rows:=jsonb_set(rows,array[idx::text],row_value);
    if not exists(select 1 from jsonb_array_elements(rows) b where b->>'produced_at' is null) then r:=r||jsonb_build_object('ended_at',at_time);end if;
   end if;
  end if;
  r:=r||jsonb_build_object('stops',stops);update public.prisma_press_sheets set runtime=r,bobinas=rows,version=version+1,updated_at=at_time where id=s.id;perform public.prisma_sync_press_incidents(s.id);
 else
  if is_production and op='save' and exists(select 1 from jsonb_object_keys(payload->'fields') k where k not in ('observations','press_signature')) then raise exception 'Los datos de planeación se capturan en la orden; los metros se registran por bobina.';end if;
  if is_production and op='save' and s.runtime->>'ended_at' is not null then raise exception 'La producción ya terminó.';end if;
  perform public.prisma_press_sheet_v2_internal(access_key,payload);
 end if;
 select * into s from public.prisma_press_sheets where id=s.id;r:=s.runtime;stops:=coalesce(r->'stops','[]');
 result:=public.prisma_press_sheet_v2_internal(access_key,jsonb_build_object('operation','get'))-'runtime';
 select coalesce(jsonb_agg(case when b->>'started_at' is not null and b->>'produced_at' is null then b||jsonb_build_object('elapsed_seconds',public.prisma_press_net_seconds(stops,(b->>'started_at')::timestamptz,at_time)) else b end order by ordinal),'[]') into active_rows from jsonb_array_elements(s.bobinas) with ordinality as entry(b,ordinal);
 return result||jsonb_build_object('workflow_version',3,'closed',is_production and o.status='confirmed','production_started',r->>'started_at' is not null,'production_closed',r->>'ended_at' is not null or (jsonb_array_length(s.bobinas)>0 and not exists(select 1 from jsonb_array_elements(s.bobinas) b where b->>'produced_at' is null)),'bobinas',active_rows,'paused',exists(select 1 from jsonb_array_elements(stops) j where j->>'ended_at' is null),'can_resume',exists(select 1 from jsonb_array_elements(stops) j where j->>'ended_at' is null and j->>'reason'<>'incidencia'),'pause_message',case when exists(select 1 from jsonb_array_elements(stops) j where j->>'ended_at' is null and j->>'reason'='incidencia') then 'Paro por incidencia de máquina' else coalesce((select j->>'reason' from jsonb_array_elements(stops) j where j->>'ended_at' is null limit 1),'') end,'actual_meters',(select coalesce(sum((b->>'actual_meters')::numeric),0) from jsonb_array_elements(s.bobinas) b),'server_now',at_time);
end $$;
create or replace function public.prisma_order_press_close_trigger() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare s record;at_time timestamptz:=clock_timestamp();runtime_value jsonb;stops jsonb;
begin
 if new.status in ('confirmed','cancelled') and old.status is distinct from new.status then
  for s in select * from public.prisma_press_sheets where order_id=new.id and runtime->>'started_at' is not null and runtime->>'ended_at' is null for update loop
   select coalesce(jsonb_agg(case when stop->>'ended_at' is null then stop||jsonb_build_object('ended_at',at_time) else stop end),'[]') into stops from jsonb_array_elements(coalesce(s.runtime->'stops','[]')) stop;
   runtime_value:=s.runtime||jsonb_build_object('ended_at',at_time,'closed_by_order',new.status,'stops',stops);
   update public.prisma_press_sheets set runtime=runtime_value,version=version+1 where id=s.id;
  end loop;
 end if;return new;
end $$;
drop trigger if exists prisma_order_press_close on public.prisma_orders;
create trigger prisma_order_press_close after update of status on public.prisma_orders for each row execute function public.prisma_order_press_close_trigger();
revoke all on function public.prisma_order_press_close_trigger() from public,anon,authenticated;
-- Catálogos y validación existentes se conservan; las nuevas órdenes requieren planeación.
create or replace function public.prisma_order_portal(access_key text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare input jsonb:=payload->'order';plan jsonb:='{}';key text;n numeric;result jsonb;stored jsonb;
begin
 if payload->>'operation' is distinct from 'submit' then return public.prisma_order_portal_plan_internal(access_key,payload)||jsonb_build_object('production_workflow_version',3);end if;
 perform public.prisma_order_portal_plan_internal(access_key,jsonb_build_object('operation','catalog'));
 foreach key in array array['reel_meters','expected_bobina_minutes','expected_production_minutes'] loop
  if coalesce(input->>key,'') !~ '^[0-9]+([.][0-9]+)?$' then raise exception 'Captura metros por bobina y tiempos esperados.';end if;n:=(input->>key)::numeric;if n<=0 or n>1e9 then raise exception 'Planeación no válida.';end if;plan:=plan||jsonb_build_object(key,n);
 end loop;
 if coalesce(btrim(input->>'finish'),'')='' or length(input->>'finish')>200 or coalesce(input->>'has_crease','') not in ('yes','no') or coalesce(input->>'die_id','') !~ '^[1-9][0-9]*$' or (input->>'has_crease'='yes' and coalesce(input->>'crease_id','') !~ '^[1-9][0-9]*$') then raise exception 'Captura acabado, suaje y si lleva pleca.';end if;
 if (input->>'meters')::numeric/(plan->>'reel_meters')::numeric>10000 then raise exception 'Máximo 10,000 bobinas por orden.';end if;
 plan:=plan||jsonb_build_object('finish',btrim(input->>'finish'),'has_crease',input->>'has_crease');
 foreach key in array array['width_mm','height_mm'] loop if coalesce(input->>key,'')<>'' then if input->>key !~ '^[0-9]+([.][0-9]+)?$' then raise exception 'Medida en milímetros no válida.';end if;n:=(input->>key)::numeric;if n<=0 or n>1e6 then raise exception 'Medida en milímetros no válida.';end if;plan:=plan||jsonb_build_object(key,n);end if;end loop;
 if input->>'has_crease'='no' then payload:=jsonb_set(payload,'{order,crease_id}','null');end if;
 result:=public.prisma_order_portal_plan_internal(access_key,payload);
 select specifications->'production_plan' into stored from public.prisma_orders where id=(result->>'id')::bigint;
 if coalesce((result->>'duplicate')::boolean,false) and stored is distinct from plan then raise exception 'La captura ya fue enviada con otra planeación.';end if;
 update public.prisma_orders set specifications=specifications||jsonb_build_object('production_plan',plan) where id=(result->>'id')::bigint;return result;
end $$;
-- Solo pendientes en los enlaces compartidos. El perfil conserva los finalizados.
create or replace function public.prisma_press_queue(access_key text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.prisma_press_queues%rowtype;stage text;result jsonb;
begin
 if access_key is null or access_key !~ '^(pq|rq)_[a-f0-9]{64}$' then raise exception 'Enlace no autorizado.';end if;
 select * into q from public.prisma_press_queues queue where queue.production_key=prisma_press_queue.access_key or queue.rewind_key=prisma_press_queue.access_key;if not found then raise exception 'Enlace no autorizado.';end if;stage:=case when q.production_key=access_key then 'production' else 'rewind' end;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'access_key',case when stage='production' then s.access_key else s.rewind_key end,'bobinas',s.bobinas,'source',jsonb_build_object('folio',s.source->'folio','np',s.source->'np','product',s.source->'product','machine',s.source->'machine','date',s.source->'date','planned_meters',s.source->'planned_meters')) order by s.id),'[]') into result from public.prisma_press_sheets s join public.prisma_orders o on o.id=s.order_id where s.profile_id=q.profile_id and o.status<>'cancelled' and (case when stage='production' then o.status<>'confirmed' and s.runtime->>'ended_at' is null and exists(select 1 from jsonb_array_elements(s.bobinas) b where b->>'produced_at' is null) else exists(select 1 from jsonb_array_elements(s.bobinas) b where b->>'produced_at' is not null and b->>'rewound_at' is null) end);
 return jsonb_build_object('workflow_version',3,'stage',stage,'sheets',result);
end $$;
-- La bitácora de paros nunca sale en enlaces ni en PDF públicos.
create or replace function public.prisma_production_audit(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare day date;zone text;headers jsonb;start_day timestamptz;end_day timestamptz;result jsonb;
begin
 perform public.prisma_require_permission('production_audit');
 headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;zone:=substring(headers->>'x-client-info' from 'time-zone=([^; ]+)');if zone is null or not exists(select 1 from pg_timezone_names where name=zone) then zone:='America/Mexico_City';end if;
 if coalesce(payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Fecha no válida.';end if;day:=(payload->>'date')::date;start_day:=day::timestamp at time zone zone;end_day:=(day+1)::timestamp at time zone zone;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'order_id',s.order_id,'source',s.source-'reportLogo','started_at',s.runtime->'started_at','ended_at',s.runtime->'ended_at','closure_reason',s.runtime->'closed_by_order','stops',coalesce((select jsonb_agg(stop||jsonb_build_object('seconds',greatest(0,extract(epoch from least(end_day,coalesce((stop->>'ended_at')::timestamptz,now()))-greatest(start_day,(stop->>'started_at')::timestamptz))),'started_in_day',(stop->>'started_at')::timestamptz>=start_day and (stop->>'started_at')::timestamptz<end_day)) from jsonb_array_elements(coalesce(s.runtime->'stops','[]')) stop),'[]'::jsonb),'bobinas',s.bobinas,'gross_seconds',extract(epoch from least(end_day,coalesce((s.runtime->>'ended_at')::timestamptz,now()))-greatest(start_day,(s.runtime->>'started_at')::timestamptz)),'net_seconds',public.prisma_press_net_seconds(coalesce(s.runtime->'stops','[]'),greatest(start_day,(s.runtime->>'started_at')::timestamptz),least(end_day,coalesce((s.runtime->>'ended_at')::timestamptz,now())))) order by s.id desc),'[]'::jsonb) into result from public.prisma_press_sheets s where (s.runtime->>'started_at')::timestamptz<end_day and coalesce((s.runtime->>'ended_at')::timestamptz,now())>start_day;
 return jsonb_build_object('date',day,'sessions',result,'references',jsonb_build_object('bathroom_visits',3,'bathroom_minutes',10,'meal_minutes',45));
end $$;
revoke all on function public.prisma_press_sheets(jsonb),public.prisma_press_sheet(text,jsonb),public.prisma_order_portal(text,jsonb),public.prisma_press_queue(text),public.prisma_production_audit(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_press_sheets(jsonb),public.prisma_production_audit(jsonb) to authenticated;
grant execute on function public.prisma_press_sheet(text,jsonb),public.prisma_order_portal(text,jsonb),public.prisma_press_queue(text) to anon,authenticated;
create or replace function public.prisma_admin_accounts(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid;person auth.users%rowtype;allowed text[]:=array['inventory','movements','catalog','production','preparation','incidents','cuts','devices','settings','production_audit'];requested text[];op text:=payload->>'operation';result jsonb;
begin
 perform public.prisma_require_admin();
 if op in ('approve','revoke','reject') then
  target:=(payload->>'user_id')::uuid;select * into person from auth.users where id=target;if not found then raise exception 'Cuenta no encontrada.';end if;
  if exists(select 1 from public.prisma_admins where user_id=target) then raise exception 'No puedes cambiar el acceso de una cuenta administradora desde esta pantalla.';end if;
  if op='approve' then
   if person.email_confirmed_at is null or (not exists(select 1 from public.prisma_members where user_id=target) and (person.confirmation_sent_at is null or person.email_confirmed_at<person.confirmation_sent_at)) then raise exception 'La cuenta debe verificar su correo con el código antes de autorizarla.';end if;
   if jsonb_typeof(payload->'permissions') is distinct from 'array' then raise exception 'Selecciona los permisos.';end if;
   select array_agg(distinct value) into requested from jsonb_array_elements_text(payload->'permissions');
   if coalesce(cardinality(requested),0)=0 or not requested<@allowed then raise exception 'Selecciona al menos un permiso válido.';end if;
   insert into public.prisma_members(user_id,permissions) values(target,requested) on conflict(user_id) do update set permissions=excluded.permissions;
  else
   delete from public.prisma_members where user_id=target;
   if to_regclass('public.prisma_notification_devices') is not null then update public.prisma_notification_devices set enabled=false where user_id=target;end if;
  end if;
  insert into public.prisma_account_decisions(user_id,status,reviewer) values(target,case when op='approve' then 'approved' when op='reject' then 'rejected' else 'revoked' end,auth.uid()) on conflict(user_id) do update set status=excluded.status,reviewer=excluded.reviewer,reviewed_at=now();
 elsif op is distinct from 'list' then raise exception 'Acción no válida.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'name',left(coalesce(u.raw_user_meta_data->>'display_name',''),100),'created_at',u.created_at,'email_verified',u.email_confirmed_at is not null and (m.user_id is not null or (u.confirmation_sent_at is not null and u.email_confirmed_at>=u.confirmation_sent_at)),'approved',m.user_id is not null,'is_admin',a.user_id is not null,'permissions',coalesce(to_jsonb(m.permissions),'[]'::jsonb),'status',case when m.user_id is not null then 'approved' else coalesce(d.status,'pending') end) order by u.created_at desc),'[]'::jsonb) into result from auth.users u left join public.prisma_members m on m.user_id=u.id left join public.prisma_admins a on a.user_id=u.id left join public.prisma_account_decisions d on d.user_id=u.id;
 return jsonb_build_object('accounts',result);
end $$;
notify pgrst,'reload schema';
commit;
