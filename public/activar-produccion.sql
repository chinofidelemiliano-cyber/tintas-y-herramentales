-- Ejecutar TODO el archivo en una consulta nueva, sin seleccionar fragmentos.
-- Aplicar después de operator-profiles.sql. Conserva órdenes, sesiones y existencias.
begin;
alter table public.prisma_incidents add column if not exists origin_stage text not null default '';
alter table public.prisma_incidents add column if not exists operator_username text;
alter table public.prisma_preparations add column if not exists profile_id uuid references auth.users(id);
alter table public.prisma_preparations add column if not exists prepared_by text not null default '';
-- Una incidencia propia de rebobinado no detiene una prensa que aún está imprimiendo.
do $$declare definition text;begin definition:=pg_get_functiondef('public.prisma_sync_press_incidents(bigint)'::regprocedure);if position('i.origin_stage' in definition)=0 then execute replace(definition,'i.impact=''Paro''','i.impact=''Paro'' and i.origin_stage<>''rewind''');end if;end $$;
create or replace function public.prisma_sync_rewind_incidents(sheet_id bigint) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.prisma_press_sheets%rowtype;r jsonb;stops jsonb;i record;position integer;begin_at timestamptz;end_at timestamptz;
begin select * into s from public.prisma_press_sheets where id=sheet_id for update;r:=s.runtime->'rewind';if r->>'started_at' is null then return;end if;stops:=coalesce(r->'stops','[]');
 for i in select * from public.prisma_incidents where order_id=s.order_id and origin_stage='rewind' and started_at is not null loop
  begin_at:=greatest(i.started_at,(r->>'started_at')::timestamptz);if r->>'ended_at' is not null and begin_at>=(r->>'ended_at')::timestamptz then continue;end if;
  end_at:=coalesce(i.ended_at,case when i.status='Cerrada' then clock_timestamp() end);if r->>'ended_at' is not null then end_at:=least(coalesce(end_at,(r->>'ended_at')::timestamptz),(r->>'ended_at')::timestamptz);end if;
  select ord::integer-1 into position from jsonb_array_elements(stops) with ordinality as item(j,ord) where j->>'incident_id'=i.id::text;
  if position is null then stops:=stops||jsonb_build_array(jsonb_build_object('id','incident-'||i.id,'reason','incidencia','details','INC-'||lpad(i.incident_number::text,greatest(4,length(i.incident_number::text)),'0'),'incident_id',i.id,'started_at',begin_at,'ended_at',end_at));elsif end_at is not null then stops:=jsonb_set(stops,array[position::text,'ended_at'],to_jsonb(end_at));end if;
 end loop;
 if stops is distinct from coalesce(r->'stops','[]') then update public.prisma_press_sheets set runtime=jsonb_set(runtime,'{rewind}',r||jsonb_build_object('stops',stops)),version=version+1 where id=s.id;end if;
end $$;
create or replace function public.prisma_rewind_incident_trigger() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare s record;begin if tg_when='BEFORE' then if new.origin_stage='rewind' and new.status='Cerrada' and new.ended_at is null then new.ended_at:=clock_timestamp();end if;return new;end if;perform pg_advisory_xact_lock(104202611);for s in select id from public.prisma_press_sheets where order_id=new.order_id or (tg_op='UPDATE' and order_id=old.order_id) loop perform public.prisma_sync_rewind_incidents(s.id);end loop;return new;end $$;
drop trigger if exists prisma_rewind_incident_close on public.prisma_incidents;
create trigger prisma_rewind_incident_close before update on public.prisma_incidents for each row execute function public.prisma_rewind_incident_trigger();
drop trigger if exists prisma_rewind_incident_sync on public.prisma_incidents;
create trigger prisma_rewind_incident_sync after insert or update on public.prisma_incidents for each row execute function public.prisma_rewind_incident_trigger();
create or replace function public.prisma_rewind_cancel_trigger() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare s record;r jsonb;stops jsonb;rolls jsonb;t timestamptz:=clock_timestamp();begin if new.status='cancelled' and old.status is distinct from new.status then for s in select * from public.prisma_press_sheets where order_id=new.id and runtime->'rewind'->>'started_at' is not null and runtime->'rewind'->>'ended_at' is null for update loop r:=s.runtime->'rewind';select coalesce(jsonb_agg(case when stop->>'ended_at' is null then stop||jsonb_build_object('ended_at',t) else stop end),'[]') into stops from jsonb_array_elements(coalesce(r->'stops','[]')) stop;select coalesce(jsonb_agg(case when roll->>'ended_at' is null then roll||jsonb_build_object('ended_at',t,'elapsed_seconds',public.prisma_press_net_seconds(stops,(roll->>'started_at')::timestamptz,t)) else roll end),'[]') into rolls from jsonb_array_elements(coalesce(r->'rolls','[]')) roll;update public.prisma_press_sheets set runtime=jsonb_set(runtime,'{rewind}',r||jsonb_build_object('ended_at',t,'closed_by_order','cancelled','stops',stops,'rolls',rolls)),version=version+1 where id=s.id;end loop;end if;return new;end $$;
drop trigger if exists prisma_rewind_cancel on public.prisma_orders;
create trigger prisma_rewind_cancel after update of status on public.prisma_orders for each row execute function public.prisma_rewind_cancel_trigger();
create or replace function public.prisma_rewind_public(sheet_id bigint) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.prisma_press_sheets%rowtype;r jsonb;stops jsonb;rolls jsonb;target numeric;incidents jsonb;t timestamptz:=clock_timestamp();
begin select * into s from public.prisma_press_sheets where id=sheet_id;r:=coalesce(s.runtime->'rewind','{}');stops:=coalesce(r->'stops','[]');target:=coalesce((s.source->'production_plan'->>'requested_thousands')::numeric,(s.source->>'pieces')::numeric/1000);
 select coalesce(jsonb_agg(case when roll->>'ended_at' is null then roll||jsonb_build_object('elapsed_seconds',public.prisma_press_net_seconds(stops,(roll->>'started_at')::timestamptz,t)) else roll end order by (roll->>'number')::integer),'[]') into rolls from jsonb_array_elements(coalesce(r->'rolls','[]')) roll;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'folio','INC-'||lpad(i.incident_number::text,greatest(4,length(i.incident_number::text)),'0'),'date',i.date,'order_ref',i.order_ref,'np',i.np,'machine',i.machine,'description',i.description,'prepared_by',i.prepared_by,'responsible',i.responsible,'action',i.action,'impact',i.impact,'status',i.status,'started_at',i.started_at,'ended_at',i.ended_at,'validation_notes',i.validation_notes) order by i.id desc),'[]') into incidents from public.prisma_incidents i where i.order_id=s.order_id and i.origin_stage='rewind';
 return jsonb_build_object('finishing_version',1,'rewind_started',r->>'started_at' is not null,'rewind_closed',r->>'ended_at' is not null,'rewind_paused',exists(select 1 from jsonb_array_elements(stops) p where p->>'ended_at' is null),'rewind_can_resume',exists(select 1 from jsonb_array_elements(stops) p where p->>'ended_at' is null and p->>'reason'<>'incidencia'),'rewind_pause_message',coalesce((select case p->>'reason' when 'espera_bobina' then 'En espera de otra bobina' when 'incidencia' then 'Incidencia' else p->>'reason' end from jsonb_array_elements(stops) p where p->>'ended_at' is null order by case when p->>'reason'='incidencia' then 0 else 1 end limit 1),''),'rolls',rolls,'thousands_requested',target,'thousands_actual',r->'thousands_actual','rewind_shortfall_reason',coalesce(r->>'shortfall_reason',''),'incidents',incidents);
end $$;
do $$begin
 if to_regprocedure('public.prisma_press_sheet_finishing_internal(text,jsonb)') is null then alter function public.prisma_press_sheet(text,jsonb) rename to prisma_press_sheet_finishing_internal;end if;
 execute replace(pg_get_functiondef('public.prisma_press_sheet_finishing_internal(text,jsonb)'::regprocedure),'prisma_press_sheet.access_key','prisma_press_sheet_finishing_internal.access_key');
 if to_regprocedure('public.prisma_production_audit_finishing_internal(jsonb)') is null then alter function public.prisma_production_audit(jsonb) rename to prisma_production_audit_finishing_internal;end if;
 if to_regprocedure('public.prisma_order_portal_history_internal(text,jsonb)') is null then alter function public.prisma_order_portal(text,jsonb) rename to prisma_order_portal_history_internal;end if;
 if to_regprocedure('public.prisma_save_preparation_history_internal(jsonb)') is null then alter function public.prisma_save_preparation(jsonb) rename to prisma_save_preparation_history_internal;end if;
end $$;
revoke all on function public.prisma_sync_rewind_incidents(bigint),public.prisma_rewind_incident_trigger(),public.prisma_rewind_cancel_trigger(),public.prisma_rewind_public(bigint),public.prisma_press_sheet_finishing_internal(text,jsonb),public.prisma_save_preparation_history_internal(jsonb) from public,anon,authenticated;
create or replace function public.prisma_press_sheet(access_key text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;actor jsonb;s public.prisma_press_sheets%rowtype;r jsonb;stops jsonb;rolls jsonb;roll jsonb;op text:=payload->>'operation';t timestamptz:=clock_timestamp();idx integer;reason text;detail text;actual numeric;target numeric;inc public.prisma_incidents%rowtype;number_value integer;prefs jsonb;
begin
 result:=public.prisma_press_sheet_finishing_internal(access_key,jsonb_build_object('operation','get','session_key',payload->>'session_key'));actor:=result->'actor';
 select * into s from public.prisma_press_sheets where id=(result->>'id')::bigint for update;perform public.prisma_sync_rewind_incidents(s.id);select * into s from public.prisma_press_sheets where id=s.id;r:=coalesce(s.runtime->'rewind','{}');stops:=coalesce(r->'stops','[]');rolls:=coalesce(r->'rolls','[]');
 if actor->>'stage'='rewind' and op<>'get' and (r->>'ended_at' is not null or coalesce((result->>'cancelled')::boolean,false)) then raise exception 'Rebobinado ya terminó o fue cancelado.';end if;
 if actor->>'stage'='rewind' and op in ('claim','start_rewind','start_roll','finish_roll','rewind_pause','rewind_resume','finish_rewind','rewind_incident','resolve_rewind_incident') then
  if op='claim' then result:=public.prisma_press_sheet_finishing_internal(access_key,payload);elsif coalesce((result->>'needs_claim')::boolean,false) then raise exception 'Primero toma la orden de rebobinado.';
  elsif (payload->>'version')::integer is distinct from s.version then raise exception 'Otra persona actualizó la orden. Pulsa Actualizar.';end if;
  if op in ('claim','start_rewind') then
   if not exists(select 1 from jsonb_array_elements(s.bobinas) b where b->>'produced_at' is not null) then raise exception 'Aún no se entrega la primera bobina.';end if;
   if r->>'started_at' is null then r:=r||jsonb_build_object('started_at',t,'stops','[]'::jsonb,'rolls','[]'::jsonb,'operator_username',actor->>'username','operator_name',actor->>'name');end if;
  else
   if r->>'started_at' is null then raise exception 'Primero inicia rebobinado.';end if;
   if op='rewind_pause' then
    if exists(select 1 from jsonb_array_elements(stops) p where p->>'ended_at' is null) then raise exception 'Ya hay un paro en curso.';end if;reason:=payload->>'reason';detail:=btrim(coalesce(payload->>'details',''));if reason is null or reason not in ('baño','comida','otro','espera_bobina') or length(detail)>500 or (reason='otro' and detail='') then raise exception 'Revisa el motivo del paro.';end if;stops:=stops||jsonb_build_array(jsonb_build_object('id','manual-'||gen_random_uuid(),'reason',reason,'details',detail,'started_at',t,'ended_at',null));
   elsif op='rewind_resume' then
    select ordinal::integer-1 into idx from jsonb_array_elements(stops) with ordinality p(j,ordinal) where j->>'ended_at' is null and j->>'reason'<>'incidencia' limit 1;if idx is null then raise exception 'Cierra la incidencia vinculada para reanudar.';end if;stops:=jsonb_set(stops,array[idx::text,'ended_at'],to_jsonb(t));
   elsif op in ('rewind_incident','resolve_rewind_incident') then
    if op='rewind_incident' then
     detail:=btrim(coalesce(payload->>'description',''));if detail='' or length(detail)>2000 or coalesce(payload->>'request_key','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Revisa el defecto y su referencia.';end if;
     select * into inc from public.prisma_incidents where request_key=payload->>'request_key';if found then if inc.order_id<>s.order_id or inc.description<>detail or inc.origin_stage<>'rewind' then raise exception 'La captura ya existe con otros datos.';end if;
     else select coalesce(max(incident_number),10)+1 into number_value from public.prisma_incidents;insert into public.prisma_incidents(incident_number,date,order_id,order_ref,np,machine,description,responsible,action,impact,status,prepared_by,validation_notes,request_key,timer_mode,started_at,origin_stage,operator_username) values(number_value,public.prisma_today(),s.order_id,s.source->>'folio',coalesce(s.source->>'np',''),coalesce(s.source->>'machine',''),detail,'','','Paro','Abierta',actor->>'name','Rebobinado · Pegar muestras físicas antes/después.',payload->>'request_key',false,t,'rewind',actor->>'username') returning * into inc;end if;
    else detail:=btrim(coalesce(payload->>'action',''));if detail='' or length(detail)>2000 then raise exception 'Describe la corrección.';end if;select * into inc from public.prisma_incidents where id=(payload->>'incident_id')::bigint and order_id=s.order_id and origin_stage='rewind';if not found then raise exception 'Incidencia no autorizada.';end if;update public.prisma_incidents set status='Cerrada',ended_at=coalesce(ended_at,t),action=detail where id=inc.id;end if;
   else
    if exists(select 1 from jsonb_array_elements(stops) p where p->>'ended_at' is null) then raise exception 'Rebobinado está en paro. Reanuda o resuelve la incidencia.';end if;
    select ordinal::integer-1 into idx from jsonb_array_elements(rolls) with ordinality p(j,ordinal) where j->>'ended_at' is null limit 1;
    if op='start_roll' then
     if idx is not null then raise exception 'Termina el rollo actual.';end if;if jsonb_array_length(rolls)>=10000 then raise exception 'Máximo 10,000 rollos por orden.';end if;rolls:=rolls||jsonb_build_array(jsonb_build_object('number',jsonb_array_length(rolls)+1,'started_at',t,'ended_at',null,'operator_name',actor->>'name','operator_username',actor->>'username'));
    elsif op='finish_roll' then if idx is null then raise exception 'Primero inicia un rollo.';end if;roll:=rolls->idx;rolls:=jsonb_set(rolls,array[idx::text],roll||jsonb_build_object('ended_at',t,'elapsed_seconds',public.prisma_press_net_seconds(stops,(roll->>'started_at')::timestamptz,t)));
    else
     target:=coalesce((s.source->'production_plan'->>'requested_thousands')::numeric,(s.source->>'pieces')::numeric/1000);if target is null or target<=0 then raise exception 'Faltan los millares solicitados. Administración debe completar la planeación.';end if;
     if coalesce(payload->>'thousands_actual','') !~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' or length(payload->>'thousands_actual')>80 then raise exception 'Captura los millares reales de toda la orden.';end if;actual:=(payload->>'thousands_actual')::numeric;reason:=btrim(coalesce(payload->>'shortfall_reason',''));if actual>1e9 or length(reason)>1000 or (actual<target and reason='') then raise exception 'Explica por qué no se completaron los millares solicitados.';end if;
     if exists(select 1 from jsonb_array_elements(s.bobinas) b where b->>'produced_at' is null or b->>'rewound_at' is null) then raise exception 'Espera y marca procesadas todas las bobinas.';end if;if actual>0 and jsonb_array_length(rolls)=0 then raise exception 'Registra al menos un rollo.';end if;
     if idx is not null then roll:=rolls->idx;rolls:=jsonb_set(rolls,array[idx::text],roll||jsonb_build_object('ended_at',t,'elapsed_seconds',public.prisma_press_net_seconds(stops,(roll->>'started_at')::timestamptz,t)));end if;r:=r||jsonb_build_object('ended_at',t,'thousands_actual',actual,'shortfall_reason',reason);
    end if;
   end if;
  end if;
  -- Los disparadores de incidencias guardan sus intervalos; no reemplazarlos por una copia anterior.
  if op not in ('rewind_incident','resolve_rewind_incident') then r:=r||jsonb_build_object('stops',stops,'rolls',rolls);update public.prisma_press_sheets set runtime=jsonb_set(runtime,'{rewind}',r),version=version+1,updated_at=t where id=s.id;end if;
 elsif actor->>'stage'='production' and op='pause' and payload->>'reason' in ('falta_material','falta_insumos') then
  if (payload->>'version')::integer is distinct from s.version then raise exception 'Otra persona actualizó la orden.';end if;if s.runtime->>'started_at' is null or s.runtime->>'ended_at' is not null or coalesce((result->>'closed')::boolean,false) or coalesce((result->>'cancelled')::boolean,false) then raise exception 'Primero inicia una producción abierta.';end if;
  if exists(select 1 from jsonb_array_elements(coalesce(s.runtime->'stops','[]')) p where p->>'ended_at' is null) then raise exception 'Ya hay un paro en curso.';end if;detail:=btrim(coalesce(payload->>'details',''));if length(detail)>500 then raise exception 'Detalle demasiado largo.';end if;update public.prisma_press_sheets set runtime=jsonb_set(runtime,'{stops}',coalesce(runtime->'stops','[]')||jsonb_build_array(jsonb_build_object('id','manual-'||gen_random_uuid(),'reason',payload->>'reason','details',detail,'started_at',t,'ended_at',null))),version=version+1,updated_at=t where id=s.id;
 elsif op<>'get' then
  if actor->>'stage'='rewind' and op='complete_bobina' and exists(select 1 from jsonb_array_elements(stops) p where p->>'ended_at' is null) then raise exception 'Rebobinado está en paro.';end if;
  result:=public.prisma_press_sheet_finishing_internal(access_key,payload);
 end if;
 perform public.prisma_sync_rewind_incidents(s.id);result:=public.prisma_press_sheet_finishing_internal(access_key,jsonb_build_object('operation','get','session_key',payload->>'session_key'));
 select preferences into prefs from public.prisma_user_preferences where user_id=s.profile_id;
 result:=result||public.prisma_rewind_public(s.id);result:=jsonb_set(result,'{source}',(result->'source')||jsonb_build_object('reportLogo',coalesce(nullif(prefs->'reportLogo','null'),result->'source'->'reportLogo'),'pdf_style',prefs->'pdfStyle'));
 if op='rewind_incident' then result:=result||jsonb_build_object('incident',(select j from jsonb_array_elements(result->'incidents') j where (j->>'id')::bigint=inc.id));end if;return result;
end $$;
create or replace function public.prisma_operator_queue(access_key text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor jsonb;rows jsonb;begin actor:=public.prisma_operator_identity(access_key,payload->>'session_key');if not (actor->>'authenticated')::boolean then raise exception 'Inicia sesión con tu usuario del área.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'access_key',case when actor->>'stage'='production' then s.access_key else s.rewind_key end,'bobinas',s.bobinas,'needs_claim',actor->>'stage'='rewind' and not (actor->>'is_manager')::boolean and o.rewind_claimed_at is null,'source',jsonb_build_object('folio',s.source->'folio','np',s.source->'np','product',s.source->'product','machine',s.source->'machine','date',s.source->'date','planned_meters',s.source->'planned_meters')) order by s.id),'[]') into rows from public.prisma_press_sheets s join public.prisma_orders o on o.id=s.order_id where s.profile_id=(actor->>'profile_id')::uuid and o.status<>'cancelled' and (case when actor->>'stage'='production' then o.status<>'confirmed' and s.runtime->>'ended_at' is null and exists(select 1 from jsonb_array_elements(s.bobinas) b where b->>'produced_at' is null) and ((actor->>'is_manager')::boolean or coalesce(o.press_operator,public.prisma_assigned_pressman(o.pressman),'')=actor->>'username') else ((actor->>'is_manager')::boolean or o.rewind_operator is null or o.rewind_operator=actor->>'username') and exists(select 1 from jsonb_array_elements(s.bobinas) b where b->>'produced_at' is not null) and (case when s.runtime->'rewind'->>'started_at' is not null then s.runtime->'rewind'->>'ended_at' is null else exists(select 1 from jsonb_array_elements(s.bobinas) b where b->>'produced_at' is not null and b->>'rewound_at' is null) end) end);
 return jsonb_build_object('workflow_version',4,'finishing_version',1,'stage',actor->>'stage','actor',actor-'profile_id','sheets',rows);
end $$;
create or replace function public.prisma_save_preparation(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;name_value text;begin result:=public.prisma_save_preparation_history_internal(payload);if nullif(payload->>'id','') is null then select coalesce(nullif(preferences->>'reportName',''),'') into name_value from public.prisma_user_preferences where user_id=auth.uid();update public.prisma_preparations set profile_id=auth.uid(),prepared_by=coalesce(name_value,'') where id=(result->>'id')::bigint;end if;return result;end $$;
create or replace function public.prisma_order_portal(access_key text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target numeric;result jsonb;stored numeric;
begin
 if payload->>'operation'='submit' then
  if coalesce(payload->'order'->>'requested_thousands','')<>'' then if payload->'order'->>'requested_thousands' !~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' then raise exception 'Captura los millares solicitados.';end if;target:=(payload->'order'->>'requested_thousands')::numeric;
  elsif coalesce(payload->'order'->>'pieces','') ~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' then target:=(payload->'order'->>'pieces')::numeric/1000;end if;
  if target is null or target<=0 or target>1e9 then raise exception 'Captura los millares solicitados.';end if;payload:=jsonb_set(payload,'{order,pieces}',to_jsonb(target*1000));
 end if;
 result:=public.prisma_order_portal_history_internal(access_key,payload);
 if payload->>'operation'='submit' then
  select coalesce((specifications->'production_plan'->>'requested_thousands')::numeric,pieces/1000) into stored from public.prisma_orders where id=(result->>'id')::bigint;
  if coalesce((result->>'duplicate')::boolean,false) then if stored is distinct from target then raise exception 'La captura ya existe con otro objetivo.';end if;
  else update public.prisma_orders set specifications=specifications||jsonb_build_object('production_plan',coalesce(specifications->'production_plan','{}')||jsonb_build_object('requested_thousands',target)) where id=(result->>'id')::bigint;end if;
 end if;return result||jsonb_build_object('finishing_version',1);
end $$;
revoke all on function public.prisma_order_portal_history_internal(text,jsonb),public.prisma_order_portal(text,jsonb) from public,anon,authenticated;
grant execute on function public.prisma_order_portal(text,jsonb) to anon,authenticated;
create or replace function public.prisma_history_record(sheet_id bigint,phase text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.prisma_press_sheets%rowtype;o public.prisma_orders%rowtype;r jsonb;source_value jsonb;prefs jsonb;finished timestamptz;person text;person_key text;metrics jsonb;legacy boolean:=false;gross numeric;net numeric;net_without_wait numeric;doc jsonb;
begin select * into s from public.prisma_press_sheets where id=sheet_id;select * into o from public.prisma_orders where id=s.order_id;select preferences into prefs from public.prisma_user_preferences where user_id=s.profile_id;source_value:=s.source-'reportLogo';
 if phase='preparation' then finished:=(s.source->>'ended_at')::timestamptz;if finished is null then return null;end if;person:=coalesce(nullif(s.source->>'prepared_by',''),prefs->>'reportName','Preparación sin nombre');person_key:='owner:'||s.profile_id;metrics:=jsonb_build_object('net_seconds',case when s.source->>'started_at' is not null then extract(epoch from finished-(s.source->>'started_at')::timestamptz) end);source_value:=source_value||jsonb_build_object('prepared_by',person);
 elsif phase='production' then
  if o.status='cancelled' then return null;end if;
  if not (jsonb_array_length(s.bobinas)>0 and not exists(select 1 from jsonb_array_elements(s.bobinas) b where b->>'produced_at' is null)) and not(o.status='confirmed' and s.runtime->>'started_at' is null) then return null;end if;
  r:=s.runtime;finished:=coalesce((r->>'ended_at')::timestamptz,(select max((b->>'produced_at')::timestamptz) from jsonb_array_elements(s.bobinas) b));legacy:=r->>'started_at' is null;person:=coalesce(r->>'operator_name',s.source->>'pressman','Sin responsable verificado');person_key:=coalesce(r->>'operator_username',o.press_operator,'legacy:'||person);
  if r->>'started_at' is not null and finished is not null then gross:=extract(epoch from finished-(r->>'started_at')::timestamptz);net:=public.prisma_press_net_seconds(coalesce(r->'stops','[]'),(r->>'started_at')::timestamptz,finished);end if;metrics:=jsonb_build_object('gross_seconds',gross,'net_seconds',net,'actual_meters',(select sum((b->>'actual_meters')::numeric) from jsonb_array_elements(s.bobinas) b));
 elsif phase='rewind' then
  if o.status='cancelled' then return null;end if;r:=coalesce(s.runtime->'rewind','{}');
  if r->>'ended_at' is null and not(r->>'started_at' is null and jsonb_array_length(s.bobinas)>0 and not exists(select 1 from jsonb_array_elements(s.bobinas) b where b->>'rewound_at' is null)) then return null;end if;
  finished:=coalesce((r->>'ended_at')::timestamptz,(select max((b->>'rewound_at')::timestamptz) from jsonb_array_elements(s.bobinas) b));legacy:=r->>'started_at' is null;person:=coalesce(r->>'operator_name',nullif(s.fields->>'rewind_signature',''),(select name from public.prisma_operators where username=coalesce(o.rewind_claimed_by,o.rewind_operator)),'Rebobinado sin nombre');person_key:=coalesce(r->>'operator_username',o.rewind_claimed_by,o.rewind_operator,'rewind:unknown');
  if r->>'started_at' is not null then gross:=extract(epoch from finished-(r->>'started_at')::timestamptz);net:=public.prisma_press_net_seconds(coalesce(r->'stops','[]'),(r->>'started_at')::timestamptz,finished);net_without_wait:=public.prisma_press_net_seconds(coalesce((select jsonb_agg(stop) from jsonb_array_elements(coalesce(r->'stops','[]')) stop where stop->>'reason'<>'espera_bobina'),'[]'),(r->>'started_at')::timestamptz,finished);end if;
  metrics:=jsonb_build_object('gross_seconds',gross,'net_seconds',net,'dead_seconds',gross-net_without_wait,'waiting_seconds',net_without_wait-net);
 else raise exception 'Área no válida.';end if;
 doc:=jsonb_build_object('id',s.id,'stage',phase,'source',source_value,'fields',s.fields,'bobinas',s.bobinas,'metrics',metrics);if phase='rewind' then doc:=doc||public.prisma_rewind_public(s.id);end if;
 return jsonb_build_object('id',phase||':'||s.id,'stage',phase,'responsible_key',person_key,'responsible_name',person,'completed_at',finished,'completed_date',s.source->'date','folio',s.source->'folio','product',s.source->'product','np',s.source->'np','metrics',metrics,'legacy',legacy,'sheet',doc);
end $$;
create or replace function public.prisma_work_history(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare all_rows jsonb:='[]';item jsonb;s record;phase text;p record;ids text[];selected jsonb;logo jsonb;target numeric;
begin
 perform public.prisma_require_permission('production_audit');
 if payload->>'operation'='set_requested' then
  perform public.prisma_require_admin();perform pg_advisory_xact_lock(104202611);
  if coalesce(payload->>'requested_thousands','') !~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' then raise exception 'Objetivo no válido.';end if;target:=(payload->>'requested_thousands')::numeric;if target<=0 or target>1e9 then raise exception 'Objetivo no válido.';end if;
  select * into s from public.prisma_press_sheets where id=(payload->>'sheet_id')::bigint for update;if not found or s.runtime->'rewind'->>'ended_at' is not null then raise exception 'Orden no encontrada o rebobinado cerrado.';end if;
  update public.prisma_press_sheets set source=jsonb_set(source,'{pieces}',to_jsonb(target*1000))||jsonb_build_object('production_plan',coalesce(source->'production_plan','{}')||jsonb_build_object('requested_thousands',target)),version=version+1 where id=s.id;update public.prisma_orders set pieces=target*1000 where id=s.order_id;return jsonb_build_object('ok',true);
 end if;
 if payload->>'operation' not in ('list','documents') then raise exception 'Acción no válida.';end if;
 for s in select id from public.prisma_press_sheets order by id loop
  foreach phase in array array['preparation','production','rewind'] loop item:=public.prisma_history_record(s.id,phase);if item is not null then all_rows:=all_rows||jsonb_build_array(item);end if;end loop;
 end loop;
 for p in select * from public.prisma_preparations order by date,id loop
  item:=jsonb_build_object('id','manual:'||p.id,'stage','preparation','responsible_key',case when p.profile_id is null then 'manual:unknown' else 'owner:'||p.profile_id end,'responsible_name',coalesce(nullif(p.prepared_by,''),'Preparación sin responsable verificado'),'completed_at',null,'completed_date',p.date,'folio',p.folio,'product',p.product,'np',p.np,'legacy',p.profile_id is null,'metrics',jsonb_build_object('net_seconds',p.minutes*60),'sheet',jsonb_build_object('id',p.id,'stage','preparation','source',jsonb_build_object('folio',p.folio,'np',p.np,'product',p.product,'date',p.date,'prepared_by',p.prepared_by,'started_display',p.start_time,'ended_display',p.end_time||case when p.end_next_day then ' (+1 día)' else '' end,'supplies',p.supplies,'notes',p.notes,'colors','[]'::jsonb),'fields','{}'::jsonb,'bobinas','[]'::jsonb,'metrics',jsonb_build_object('net_seconds',p.minutes*60)));all_rows:=all_rows||jsonb_build_array(item);
 end loop;
 if payload->>'operation'='list' then return jsonb_build_object('records',coalesce((select jsonb_agg(j-'sheet') from jsonb_array_elements(all_rows) j),'[]'));end if;
 if jsonb_typeof(payload->'ids') is distinct from 'array' or jsonb_array_length(payload->'ids')>100 then raise exception 'Selecciona hasta 100 documentos por solicitud.';end if;
 select array_agg(distinct id) into ids from jsonb_array_elements_text(payload->'ids') id;
 select coalesce(jsonb_agg(j),'[]') into selected from jsonb_array_elements(all_rows) j where j->>'id'=any(ids);if jsonb_array_length(selected)<>coalesce(cardinality(ids),0) then raise exception 'Registro no autorizado o no concluido.';end if;
 select nullif(preferences->'reportLogo','null') into logo from public.prisma_user_preferences where user_id=auth.uid();if logo is null then select nullif(source->'reportLogo','null') into logo from public.prisma_press_sheets where source->>'reportLogo' is not null order by id desc limit 1;end if;
 return jsonb_build_object('records',selected,'logo',logo);
end $$;
create or replace function public.prisma_production_audit(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;records jsonb;headers jsonb;zone text;day date;a timestamptz;z timestamptz;
begin result:=public.prisma_production_audit_finishing_internal(payload);headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;zone:=substring(headers->>'x-client-info' from 'time-zone=([^; ]+)');if zone is null or not exists(select 1 from pg_timezone_names where name=zone) then zone:='America/Mexico_City';end if;day:=(payload->>'date')::date;a:=day::timestamp at time zone zone;z:=(day+1)::timestamp at time zone zone;
 select coalesce(jsonb_agg(jsonb_build_object('id','rewind:'||s.id,'stage','rewind','order_id',s.order_id,'source',s.source-'reportLogo','started_at',s.runtime->'rewind'->'started_at','ended_at',s.runtime->'rewind'->'ended_at','performed_by',s.runtime->'rewind'->'operator_name','performed_username',s.runtime->'rewind'->'operator_username','bobinas','[]'::jsonb,'rolls',coalesce(s.runtime->'rewind'->'rolls','[]'),'gross_seconds',extract(epoch from least(z,coalesce((s.runtime->'rewind'->>'ended_at')::timestamptz,now()))-greatest(a,(s.runtime->'rewind'->>'started_at')::timestamptz)),'net_seconds',public.prisma_press_net_seconds(coalesce(s.runtime->'rewind'->'stops','[]'),greatest(a,(s.runtime->'rewind'->>'started_at')::timestamptz),least(z,coalesce((s.runtime->'rewind'->>'ended_at')::timestamptz,now()))),'stops',coalesce((select jsonb_agg(p||jsonb_build_object('seconds',greatest(0,extract(epoch from least(z,coalesce((p->>'ended_at')::timestamptz,now()))-greatest(a,(p->>'started_at')::timestamptz))),'started_in_day',(p->>'started_at')::timestamptz>=a and (p->>'started_at')::timestamptz<z)) from jsonb_array_elements(coalesce(s.runtime->'rewind'->'stops','[]')) p),'[]'))),'[]') into records from public.prisma_press_sheets s where (s.runtime->'rewind'->>'started_at')::timestamptz<z and coalesce((s.runtime->'rewind'->>'ended_at')::timestamptz,now())>a;
 select coalesce(jsonb_agg(row_value||jsonb_build_object('dead_seconds',case when row_value->>'started_at' is null then 0 else (row_value->>'gross_seconds')::numeric-public.prisma_press_net_seconds(coalesce((select jsonb_agg(p) from jsonb_array_elements(row_value->'stops') p where p->>'reason'<>'espera_bobina'),'[]'),greatest(a,(row_value->>'started_at')::timestamptz),least(z,coalesce((row_value->>'ended_at')::timestamptz,now()))) end,'waiting_seconds',case when row_value->>'started_at' is null then 0 else public.prisma_press_net_seconds(coalesce((select jsonb_agg(p) from jsonb_array_elements(row_value->'stops') p where p->>'reason'<>'espera_bobina'),'[]'),greatest(a,(row_value->>'started_at')::timestamptz),least(z,coalesce((row_value->>'ended_at')::timestamptz,now())))-(row_value->>'net_seconds')::numeric end)),'[]') into records from jsonb_array_elements(records) row_value;
 return result||jsonb_build_object('sessions',coalesce(result->'sessions','[]')||records);
end $$;
revoke all on function public.prisma_production_audit_finishing_internal(jsonb),public.prisma_production_audit(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_production_audit(jsonb) to authenticated;
revoke all on function public.prisma_history_record(bigint,text) from public,anon,authenticated;
revoke all on function public.prisma_press_sheet(text,jsonb),public.prisma_operator_queue(text,jsonb),public.prisma_save_preparation(jsonb),public.prisma_work_history(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_press_sheet(text,jsonb),public.prisma_operator_queue(text,jsonb) to anon,authenticated;
grant execute on function public.prisma_save_preparation(jsonb),public.prisma_work_history(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;

-- Ejecutar completo después de work-history-rewind.sql. No borra órdenes ni existencias.
begin;
alter table public.prisma_order_portal_submissions add column if not exists capture_hash text;
do $$begin
 if to_regprocedure('public.prisma_order_portal_capture_internal(text,jsonb)') is null then alter function public.prisma_order_portal(text,jsonb) rename to prisma_order_portal_capture_internal;end if;
 if to_regprocedure('public.prisma_press_sheets_capture_internal(jsonb)') is null then alter function public.prisma_press_sheets(jsonb) rename to prisma_press_sheets_capture_internal;end if;
end $$;
revoke all on function public.prisma_order_portal_capture_internal(text,jsonb),public.prisma_press_sheets_capture_internal(jsonb) from public,anon,authenticated;
create or replace function public.prisma_order_portal(access_key text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare input jsonb:=payload->'order';extra jsonb:='{}';result jsonb;field text;n numeric;row jsonb;rows jsonb:='[]';idx integer:=0;count_value integer;planned numeric;signature text;previous public.prisma_order_portal_submissions%rowtype;plan jsonb;
begin
 -- La cadena interna comprueba el enlace incluso al rechazar una captura.
 if payload->>'operation'<>'submit' then
  result:=public.prisma_order_portal_capture_internal(access_key,payload);
  if payload->>'operation'='list' then select coalesce(jsonb_agg(j||jsonb_build_object('capture_plan',coalesce(o.specifications->'production_plan','{}')) order by (j->>'queue_number')::bigint),'[]') into rows from jsonb_array_elements(result->'orders') j join public.prisma_orders o on o.id=(j->>'id')::bigint;result:=result||jsonb_build_object('orders',rows);end if;
  return result||jsonb_build_object('capture_version',2);
 end if;
 perform public.prisma_order_portal_capture_internal(access_key,jsonb_build_object('operation','catalog'));
 perform pg_advisory_xact_lock(104202611);
 if input->>'capture_version' is distinct from '2' then raise exception 'Actualiza la página de captura para completar todos los datos de la orden.';end if;
 if octet_length(input::text)>4000000 then raise exception 'La captura supera el tamaño permitido.';end if;
 foreach field in array array['turns_machine_1','turns_machine_2','turns_machine_3','category','material_surface','material_adhesive','material_liner','material_code','core_material','box_size','bag'] loop
  if jsonb_typeof(input->field) is distinct from 'string' or coalesce(btrim(input->>field),'')='' or length(input->>field)>200 then raise exception 'Completa los datos de material y empaque: %.',field;end if;extra:=extra||jsonb_build_object(field,btrim(input->>field));
 end loop;
 foreach field in array array['labels_per_roll','core_diameter','outer_diameter','rolls_per_box','expected_rewind_minutes','width_mm','height_mm'] loop
  if coalesce(input->>field,'') !~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' or length(input->>field)>80 then raise exception 'Completa medidas, etiquetas por rollo y empaque: %.',field;end if;n:=(input->>field)::numeric;if n<=0 or n>1e9 or (field in ('labels_per_roll','rolls_per_box') and n<>trunc(n)) or (field in ('width_mm','height_mm') and n>1e6) then raise exception 'Cantidad no válida: %.',field;end if;extra:=extra||jsonb_build_object(field,n);
 end loop;
 if coalesce(input->>'scrap_target','') !~ '^[0-9]+([.][0-9]+)?$' or (input->>'scrap_target')::numeric>100 then raise exception 'Captura el scrap objetivo de 0 a 100.';end if;extra:=extra||jsonb_build_object('scrap_target',(input->>'scrap_target')::numeric);
 if coalesce(input->>'required_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Captura la fecha solicitada.';end if;perform (input->>'required_date')::date;
 if coalesce(input->>'priority','') not in ('Baja','Normal','Alta','Urgente') then raise exception 'Selecciona la prioridad inicial.';end if;
 if coalesce(input->>'meters','') !~ '^[0-9]+([.][0-9]+)?$' or coalesce(input->>'reel_meters','') !~ '^[0-9]+([.][0-9]+)?$' or (input->>'meters')::numeric<=0 or (input->>'reel_meters')::numeric<=0 then raise exception 'Captura metros y metros por bobina.';end if;
 count_value:=ceil((input->>'meters')::numeric/(input->>'reel_meters')::numeric);if count_value>10000 or jsonb_typeof(input->'assigned_reels') is distinct from 'array' or jsonb_array_length(input->'assigned_reels')<>count_value then raise exception 'Completa las bobinas asignadas según el metraje.';end if;
 for row in select * from jsonb_array_elements(input->'assigned_reels') loop
  idx:=idx+1;for field in select unnest(array['identifier','lot']) loop if jsonb_typeof(row->field) is distinct from 'string' or coalesce(btrim(row->>field),'')='' or length(row->>field)>100 then raise exception 'Captura identificación y lote de bobina %.',idx;end if;end loop;
  foreach field in array array['width_mm','meters'] loop if coalesce(row->>field,'') !~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' or length(row->>field)>80 then raise exception 'Captura ancho y metros de bobina %.',idx;end if;n:=(row->>field)::numeric;if n<=0 or n>1e12 then raise exception 'Cantidad de bobina no válida.';end if;end loop;
  planned:=least((input->>'reel_meters')::numeric,(input->>'meters')::numeric-(idx-1)*(input->>'reel_meters')::numeric);if (row->>'meters')::numeric<planned then raise exception 'La bobina % no cubre sus metros programados.',idx;end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('number',idx,'identifier',btrim(row->>'identifier'),'lot',btrim(row->>'lot'),'width_mm',(row->>'width_mm')::numeric,'meters',(row->>'meters')::numeric));
 end loop;
 extra:=extra||jsonb_build_object('capture_version',2,'required_date',input->>'required_date','priority',input->>'priority','assigned_reels',rows);
 signature:=encode(sha256(convert_to(input::text,'UTF8')),'hex');select * into previous from public.prisma_order_portal_submissions where request_key=(payload->>'request_key')::uuid;
 if found then if previous.capture_hash is distinct from signature then raise exception 'La captura ya fue enviada con otros datos.';end if;return jsonb_build_object('id',previous.order_id,'queue_number',(select queue_number from public.prisma_orders where id=previous.order_id),'duplicate',true);end if;
 -- No enviar la tabla de bobinas a la función antigua, cuyo límite de entrada es 10 KB.
 result:=public.prisma_order_portal_capture_internal(access_key,jsonb_set(payload,'{order}',input-array['turns_machine_1','turns_machine_2','turns_machine_3','category','material_surface','material_adhesive','material_liner','material_code','core_material','box_size','bag','labels_per_roll','core_diameter','outer_diameter','rolls_per_box','expected_rewind_minutes','scrap_target','required_date','priority','assigned_reels','capture_version','production_plan']));
 select specifications->'production_plan' into plan from public.prisma_orders where id=(result->>'id')::bigint;
 update public.prisma_orders set specifications=specifications||jsonb_build_object('production_plan',coalesce(plan,'{}')||extra) where id=(result->>'id')::bigint;
 update public.prisma_order_portal_submissions set capture_hash=signature where request_key=(payload->>'request_key')::uuid;return result;
end $$;
create or replace function public.prisma_press_sheets(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;rows jsonb;begin
 result:=public.prisma_press_sheets_capture_internal(payload);
 if payload->>'operation'='list' and exists(select 1 from public.prisma_admins where user_id=auth.uid()) then
  select coalesce(jsonb_agg((to_jsonb(s)-'fields'-'runtime'-'source')||jsonb_build_object('source',s.source-'reportLogo','press_operator',o.press_operator,'rewind_operator',o.rewind_operator,'rewind_claimed_by',o.rewind_claimed_by) order by s.id desc),'[]') into rows from public.prisma_press_sheets s join public.prisma_orders o on o.id=s.order_id;result:=result||jsonb_build_object('sheets',rows);
 end if;return result;
end $$;
revoke all on function public.prisma_order_portal(text,jsonb),public.prisma_press_sheets(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_order_portal(text,jsonb) to anon,authenticated;
grant execute on function public.prisma_press_sheets(jsonb) to authenticated;
-- Las colas muestran la fecha solicitada y prioridad sin publicar material ni datos privados.
do $$begin if to_regprocedure('public.prisma_operator_queue_capture_internal(text,jsonb)') is null then alter function public.prisma_operator_queue(text,jsonb) rename to prisma_operator_queue_capture_internal;end if;end $$;
revoke all on function public.prisma_operator_queue_capture_internal(text,jsonb) from public,anon,authenticated;
create or replace function public.prisma_operator_queue(access_key text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;rows jsonb;begin result:=public.prisma_operator_queue_capture_internal(access_key,payload);
 select coalesce(jsonb_agg(jsonb_set(j,'{source}',(j->'source')||jsonb_build_object('production_plan',jsonb_build_object('required_date',s.source->'production_plan'->'required_date','priority',s.source->'production_plan'->'priority'))) order by (j->>'id')::bigint),'[]') into rows from jsonb_array_elements(result->'sheets') j join public.prisma_press_sheets s on s.id=(j->>'id')::bigint;return result||jsonb_build_object('sheets',rows);end $$;
revoke all on function public.prisma_operator_queue(text,jsonb) from public,anon,authenticated;
grant execute on function public.prisma_operator_queue(text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;

-- Solo ejecutar como propietario del proyecto desde SQL Editor. No se expone como RPC.
begin;
do $$
declare owner_id uuid;
begin
 select id into owner_id from auth.users where lower(email)='chinofidelemiliano@gmail.com' and email_confirmed_at is not null;
 if owner_id is null then raise exception 'No se encontró la cuenta verificada chinofidelemiliano@gmail.com. Revisa Authentication → Users.';end if;
 insert into public.prisma_members(user_id,permissions) values(owner_id,array['inventory','movements','catalog','production','preparation','incidents','cuts','devices','settings','production_audit']) on conflict(user_id) do update set permissions=excluded.permissions;
 insert into public.prisma_admins(user_id) values(owner_id) on conflict do nothing;
end $$;
notify pgrst,'reload schema';
commit;
