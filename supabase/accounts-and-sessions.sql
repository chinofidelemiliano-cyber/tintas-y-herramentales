-- Ejecutar completo. No cambia existencias ni incorpora usuarios nuevos al inventario automáticamente.
begin;
create table if not exists public.prisma_admins(user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.prisma_members add column if not exists permissions text[] not null default array['inventory','movements','catalog','production','preparation','incidents','cuts','devices','settings'];
create table if not exists public.prisma_account_decisions(user_id uuid primary key references auth.users(id) on delete cascade,status text not null,reviewer uuid references auth.users(id) on delete set null,reviewed_at timestamptz not null default now());
create table if not exists public.prisma_login_sessions(session_id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,device_key uuid not null,device_name text not null,browser text not null,platform text not null,origin text not null,created_at timestamptz not null default now(),last_seen_at timestamptz not null default now(),ended_at timestamptz);
alter table public.prisma_admins enable row level security;
alter table public.prisma_account_decisions enable row level security;
alter table public.prisma_login_sessions enable row level security;
revoke all on public.prisma_admins,public.prisma_account_decisions,public.prisma_login_sessions from public,anon,authenticated;
-- Toda primera lectura autorizada registra al menos la sesión, incluso con un cliente antiguo.
create or replace function public.prisma_authorize() returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare sid uuid;headers jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.prisma_members where user_id=auth.uid()) then raise exception 'Tu cuenta no tiene acceso a este inventario.';end if;
 sid:=nullif(auth.jwt()->>'session_id','')::uuid;
 if sid is not null then
  if exists(select 1 from public.prisma_login_sessions where session_id=sid and user_id=auth.uid() and ended_at is not null) then raise exception 'Esta sesión ya se cerró. Inicia sesión de nuevo.';end if;
  headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  insert into public.prisma_login_sessions(session_id,user_id,device_key,device_name,browser,platform,origin) values(sid,auth.uid(),gen_random_uuid(),'Navegador sin registro','','',left(coalesce(headers->>'origin','No informado'),500)) on conflict(session_id) do nothing;
 end if;
end $$;
-- Solo reconoce al propietario si YA estaba autorizado, nunca a un registro público nuevo.
insert into public.prisma_admins(user_id) select u.id from auth.users u join public.prisma_members m on m.user_id=u.id where lower(u.email)='chinofidelemiliano@gmail.com' and u.email_confirmed_at is not null on conflict do nothing;
create or replace function public.prisma_has_permission(person uuid,permission_name text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.prisma_admins where user_id=person) or exists(select 1 from public.prisma_members where user_id=person and permission_name=any(permissions));
$$;
create or replace function public.prisma_require_admin() returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.prisma_authorize();if auth.uid() is null or not exists(select 1 from public.prisma_admins where user_id=auth.uid()) then raise exception 'Solo el administrador puede realizar esta acción.';end if;end $$;
create or replace function public.prisma_require_permission(permission_name text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.prisma_authorize();if not public.prisma_has_permission(auth.uid(),permission_name) then raise exception 'No tienes permiso para este apartado.';end if;end $$;
create or replace function public.prisma_account_access() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare member public.prisma_members%rowtype;person auth.users%rowtype;decision text;
begin
 if auth.uid() is null then raise exception 'Inicia sesión para continuar.';end if;
 select * into person from auth.users where id=auth.uid();select * into member from public.prisma_members where user_id=auth.uid();select status into decision from public.prisma_account_decisions where user_id=auth.uid();
 return jsonb_build_object('email',person.email,'approved',member.user_id is not null,'email_verified',person.email_confirmed_at is not null and (member.user_id is not null or (person.confirmation_sent_at is not null and person.email_confirmed_at>=person.confirmation_sent_at)),'is_admin',exists(select 1 from public.prisma_admins where user_id=auth.uid()),'permissions',coalesce(to_jsonb(member.permissions),'[]'::jsonb),'session_closed',exists(select 1 from public.prisma_login_sessions where session_id=nullif(auth.jwt()->>'session_id','')::uuid and user_id=auth.uid() and ended_at is not null),'status',case when member.user_id is not null then 'approved' else coalesce(decision,'pending') end);
end $$;
create or replace function public.prisma_admin_accounts(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid;person auth.users%rowtype;allowed text[]:=array['inventory','movements','catalog','production','preparation','incidents','cuts','devices','settings'];requested text[];op text:=payload->>'operation';result jsonb;
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
create or replace function public.prisma_login_activity(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare sid uuid;op text:=payload->>'operation';record public.prisma_login_sessions%rowtype;origin_value text:=payload->>'origin';
begin
 if auth.uid() is null then raise exception 'Inicia sesión para continuar.';end if;
 sid:=nullif(auth.jwt()->>'session_id','')::uuid;if sid is null then raise exception 'Vuelve a iniciar sesión para registrar este dispositivo.';end if;
 if op='login' then
  if origin_value is null or (origin_value !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$' and origin_value !~ '^http://(localhost|127[.]0[.]0[.]1)(:[0-9]+)?$') or coalesce(btrim(payload->>'device_name'),'')='' or length(payload->>'device_name')>100 or length(coalesce(payload->>'browser',''))>80 or length(coalesce(payload->>'platform',''))>80 then raise exception 'Información de dispositivo no válida.';end if;
  insert into public.prisma_login_sessions(session_id,user_id,device_key,device_name,browser,platform,origin) values(sid,auth.uid(),(payload->>'device_key')::uuid,btrim(payload->>'device_name'),coalesce(payload->>'browser',''),coalesce(payload->>'platform',''),origin_value)
  on conflict(session_id) do update set last_seen_at=now(),device_key=excluded.device_key,device_name=excluded.device_name,browser=excluded.browser,platform=excluded.platform,origin=excluded.origin where prisma_login_sessions.user_id=auth.uid() and prisma_login_sessions.ended_at is null;
 elsif op='heartbeat' then update public.prisma_login_sessions set last_seen_at=now() where session_id=sid and user_id=auth.uid() and ended_at is null;
 elsif op='logout' then update public.prisma_login_sessions set last_seen_at=now(),ended_at=coalesce(ended_at,now()) where session_id=sid and user_id=auth.uid();
 else raise exception 'Acción de sesión no válida.';end if;
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.prisma_admin_login_sessions(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;target public.prisma_login_sessions%rowtype;
begin
 perform public.prisma_require_admin();
 if payload->>'operation'='close' then
  if (payload->>'session_id')::uuid=nullif(auth.jwt()->>'session_id','')::uuid then raise exception 'Usa Cerrar sesión para terminar tu sesión actual.';end if;
  select * into target from public.prisma_login_sessions where session_id=(payload->>'session_id')::uuid;if not found then raise exception 'Sesión no encontrada.';end if;
  update public.prisma_login_sessions set ended_at=coalesce(ended_at,now()) where session_id=target.session_id;
  if to_regclass('public.prisma_notification_devices') is not null then update public.prisma_notification_devices set enabled=false where user_id=target.user_id and device_key=target.device_key and origin=target.origin;end if;
 elsif payload->>'operation' is distinct from 'list' then raise exception 'Acción de sesión no válida.';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into result from (select s.session_id,s.user_id,u.email,s.device_name,s.browser,s.platform,s.origin,s.created_at,s.last_seen_at,s.ended_at,s.session_id=nullif(auth.jwt()->>'session_id','')::uuid as current_session from public.prisma_login_sessions s join auth.users u on u.id=s.user_id order by s.created_at desc limit 200)x;return jsonb_build_object('sessions',result);
end $$;
-- Guardar las implementaciones anteriores una vez y cerrar su ejecución directa.
do $wrap$
declare r record;
begin
 for r in select * from (values('prisma_state',''),('prisma_action','text,jsonb'),('prisma_save_preparation','jsonb'),('prisma_save_incident','jsonb'),('prisma_start_incident','jsonb'),('prisma_incident_evidence','bigint'),('prisma_order_clock','jsonb'),('prisma_complete_pantone','jsonb'),('prisma_teams_connection','jsonb'),('prisma_manage_order_portal','jsonb'),('prisma_devices','jsonb'))v(name,args) loop
  if to_regprocedure('public.'||r.name||'('||r.args||')') is not null then
   if to_regprocedure('public.'||r.name||'_internal('||r.args||')') is null then execute format('alter function public.%I(%s) rename to %I',r.name,r.args,r.name||'_internal');end if;
   execute format('revoke all on function public.%I(%s) from public,anon,authenticated',r.name||'_internal',r.args);
  end if;
 end loop;
end $wrap$;
create or replace function public.prisma_state() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 perform public.prisma_authorize();result:=public.prisma_state_internal();
 if not(public.prisma_has_permission(auth.uid(),'inventory') or public.prisma_has_permission(auth.uid(),'movements') or public.prisma_has_permission(auth.uid(),'catalog') or public.prisma_has_permission(auth.uid(),'production') or public.prisma_has_permission(auth.uid(),'preparation') or public.prisma_has_permission(auth.uid(),'cuts')) then result:=result||'{"products":[],"lots":[]}'::jsonb;end if;
 if not(public.prisma_has_permission(auth.uid(),'movements') or public.prisma_has_permission(auth.uid(),'cuts')) then result:=jsonb_set(result,'{movements}','[]'::jsonb);end if;
 if not(public.prisma_has_permission(auth.uid(),'production') or public.prisma_has_permission(auth.uid(),'preparation') or public.prisma_has_permission(auth.uid(),'incidents')) then result:=jsonb_set(result,'{orders}','[]'::jsonb);end if;
 if not public.prisma_has_permission(auth.uid(),'preparation') then result:=result||'{"preparations":[],"pantone_requests":[]}'::jsonb;end if;
 if not public.prisma_has_permission(auth.uid(),'incidents') then result:=jsonb_set(result,'{incidents}','[]'::jsonb);end if;
 if not public.prisma_has_permission(auth.uid(),'cuts') then result:=jsonb_set(result,'{cuts}','[]'::jsonb);end if;
 return result;
end $$;
create or replace function public.prisma_action(operation text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if operation='products' then perform public.prisma_require_permission('catalog');
 elsif operation='movements' then perform public.prisma_require_permission('movements');
 elsif operation='cuts' then perform public.prisma_require_permission('cuts');
 elsif operation='orders/cancel' and exists(select 1 from public.prisma_orders where id=(payload->>'id')::bigint and status='draft') and public.prisma_has_permission(auth.uid(),'preparation') then perform public.prisma_require_permission('preparation');
 elsif operation in ('orders','orders/update','orders/cancel') then perform public.prisma_require_permission('production');
 else raise exception 'Acción no permitida.';end if;
 return public.prisma_action_internal(operation,payload);
end $$;
revoke all on function public.prisma_has_permission(uuid,text),public.prisma_require_admin(),public.prisma_require_permission(text),public.prisma_account_access(),public.prisma_admin_accounts(jsonb),public.prisma_login_activity(jsonb),public.prisma_admin_login_sessions(jsonb),public.prisma_state(),public.prisma_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.prisma_account_access(),public.prisma_admin_accounts(jsonb),public.prisma_login_activity(jsonb),public.prisma_admin_login_sessions(jsonb),public.prisma_state(),public.prisma_action(text,jsonb) to authenticated;
do $optional$ begin
 if to_regprocedure('public.prisma_save_preparation_internal(jsonb)') is not null then
 execute $definition$create or replace function public.prisma_save_preparation(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $body$begin perform public.prisma_require_permission('preparation');return public.prisma_save_preparation_internal(payload);end; $body$$definition$;
 execute 'revoke all on function public.prisma_save_preparation(jsonb) from public,anon,authenticated';execute 'grant execute on function public.prisma_save_preparation(jsonb) to authenticated';
 end if;
end $optional$;
do $optional$ begin
 if to_regprocedure('public.prisma_save_incident_internal(jsonb)') is not null then
 execute $definition$create or replace function public.prisma_save_incident(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $body$begin perform public.prisma_require_permission('incidents');return public.prisma_save_incident_internal(payload);end; $body$$definition$;
 execute 'revoke all on function public.prisma_save_incident(jsonb) from public,anon,authenticated';execute 'grant execute on function public.prisma_save_incident(jsonb) to authenticated';
 end if;
end $optional$;
do $optional$ begin
 if to_regprocedure('public.prisma_start_incident_internal(jsonb)') is not null then
 execute $definition$create or replace function public.prisma_start_incident(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $body$begin perform public.prisma_require_permission('incidents');return public.prisma_start_incident_internal(payload);end; $body$$definition$;
 execute 'revoke all on function public.prisma_start_incident(jsonb) from public,anon,authenticated';execute 'grant execute on function public.prisma_start_incident(jsonb) to authenticated';
 end if;
end $optional$;
do $optional$ begin
 if to_regprocedure('public.prisma_incident_evidence_internal(bigint)') is not null then
 execute $definition$create or replace function public.prisma_incident_evidence(record_id bigint) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $body$begin perform public.prisma_require_permission('incidents');return public.prisma_incident_evidence_internal(record_id);end; $body$$definition$;
 execute 'revoke all on function public.prisma_incident_evidence(bigint) from public,anon,authenticated';execute 'grant execute on function public.prisma_incident_evidence(bigint) to authenticated';
 end if;
end $optional$;
do $optional$ begin
 if to_regprocedure('public.prisma_order_clock_internal(jsonb)') is not null then
 execute $definition$create or replace function public.prisma_order_clock(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $body$begin perform public.prisma_require_permission('preparation');return public.prisma_order_clock_internal(payload);end; $body$$definition$;
 execute 'revoke all on function public.prisma_order_clock(jsonb) from public,anon,authenticated';execute 'grant execute on function public.prisma_order_clock(jsonb) to authenticated';
 end if;
end $optional$;
do $optional$ begin
 if to_regprocedure('public.prisma_complete_pantone_internal(jsonb)') is not null then
 execute $definition$create or replace function public.prisma_complete_pantone(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $body$begin perform public.prisma_require_permission('preparation');return public.prisma_complete_pantone_internal(payload);end; $body$$definition$;
 execute 'revoke all on function public.prisma_complete_pantone(jsonb) from public,anon,authenticated';execute 'grant execute on function public.prisma_complete_pantone(jsonb) to authenticated';
 end if;
end $optional$;
do $optional$ begin
 if to_regprocedure('public.prisma_teams_connection_internal(jsonb)') is not null then
 execute $definition$create or replace function public.prisma_teams_connection(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $body$begin perform public.prisma_require_admin();return public.prisma_teams_connection_internal(payload);end; $body$$definition$;
 execute 'revoke all on function public.prisma_teams_connection(jsonb) from public,anon,authenticated';execute 'grant execute on function public.prisma_teams_connection(jsonb) to authenticated';
 end if;
end $optional$;
do $optional$ begin
 if to_regprocedure('public.prisma_manage_order_portal_internal(jsonb)') is not null then
 execute $definition$create or replace function public.prisma_manage_order_portal(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $body$begin perform public.prisma_require_admin();return public.prisma_manage_order_portal_internal(payload);end; $body$$definition$;
 execute 'revoke all on function public.prisma_manage_order_portal(jsonb) from public,anon,authenticated';execute 'grant execute on function public.prisma_manage_order_portal(jsonb) to authenticated';
 end if;
end $optional$;
do $optional$ begin
 if to_regprocedure('public.prisma_devices_internal(jsonb)') is not null then
 execute $definition$create or replace function public.prisma_devices(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $body$begin perform public.prisma_require_permission('devices');return public.prisma_devices_internal(payload);end; $body$$definition$;
 execute 'revoke all on function public.prisma_devices(jsonb) from public,anon,authenticated';execute 'grant execute on function public.prisma_devices(jsonb) to authenticated';
 end if;
end $optional$;
do $push_optional$ begin if to_regclass('public.prisma_notification_jobs') is not null then execute $definition$create or replace function public.prisma_queue_order_push() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.prisma_notification_jobs(device_id,order_id)
 select d.id,new.id from public.prisma_notification_devices d join public.prisma_members m on m.user_id=d.user_id where d.enabled and public.prisma_has_permission(d.user_id,'devices') and (public.prisma_has_permission(d.user_id,'preparation') or public.prisma_has_permission(d.user_id,'production')) on conflict do nothing;
 perform public.prisma_wake_push();return new;
end $$;$definition$;end if;end $push_optional$;
do $push_optional$ begin if to_regclass('public.prisma_notification_jobs') is not null then execute $definition$create or replace function public.prisma_claim_push_jobs() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 update public.prisma_notification_jobs set status='failed',finished_at=now(),last_error='PUSH_RETRIES_EXHAUSTED' where status='sending' and attempts>=5 and leased_at<now()-interval '3 minutes';
 update public.prisma_notification_jobs j set status='skipped',finished_at=now() where j.status in ('pending','sending') and not exists(select 1 from public.prisma_notification_devices d join public.prisma_members m on m.user_id=d.user_id where d.id=j.device_id and d.enabled and public.prisma_has_permission(d.user_id,'devices') and (public.prisma_has_permission(d.user_id,'preparation') or public.prisma_has_permission(d.user_id,'production')));
 with picked as (
  select j.id from public.prisma_notification_jobs j where j.attempts<5 and ((j.status='pending' and j.due_at<=now()) or (j.status='sending' and j.leased_at<now()-interval '3 minutes')) order by j.id for update skip locked limit 20
 ),claimed as (
  update public.prisma_notification_jobs j set status='sending',attempts=attempts+1,leased_at=now() from picked where j.id=picked.id returning j.*
 ) select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'attempt',j.attempts,'device_id',d.id,'subscription',jsonb_build_object('endpoint',d.endpoint,'keys',jsonb_build_object('p256dh',d.p256dh,'auth',d.auth_key)),'payload',jsonb_build_object('eventId','push-'||j.id,'deviceKey',d.device_key,'title',case when j.order_id is null then 'Notificaciones activadas' else 'Nueva orden de producción' end,'body',case when j.order_id is null then 'Este dispositivo puede recibir avisos de órdenes nuevas.' else left(o.folio||case when coalesce(o.np,'')<>'' then ' · NP '||o.np else '' end,180) end,'url','/#preparacion'))),'[]'::jsonb) into result from claimed j join public.prisma_notification_devices d on d.id=j.device_id left join public.prisma_orders o on o.id=j.order_id;
 return result;
end $$;$definition$;end if;end $push_optional$;
notify pgrst, 'reload schema';
commit;
