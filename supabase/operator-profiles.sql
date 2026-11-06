-- Aplicar después de production-sessions.sql. No crea usuarios del panel ni cambia inventario.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.prisma_operators(username text primary key,name text not null,stage text not null check(stage in ('production','rewind')),password_hash text not null,enabled boolean not null default true,failed_attempts integer not null default 0,window_started timestamptz not null default now());
create table if not exists public.prisma_operator_sessions(session_hash text primary key,username text not null references public.prisma_operators(username),profile_id uuid not null references auth.users(id),expires_at timestamptz not null);
alter table public.prisma_operators enable row level security;
alter table public.prisma_operator_sessions enable row level security;
revoke all on public.prisma_operators,public.prisma_operator_sessions from public,anon,authenticated;
insert into public.prisma_operators(username,name,stage,password_hash) values
('JRU','Julio Rocha','production','$2a$12$uyHCKzRMRvRRH9pcgiVW8O8tp2z8pWakffMQiwvxg33zKSAWTEPBy'),
('MCR','Manuel Carrillo','production','$2a$12$blAvb2r5O.ARbyiZgcn.pO5lg/nGsOYkglX3CfyKLlHdi.iqApfS.'),
('AA','Aurora Arroyo','rewind','$2a$12$jgik1gVRsD.X8lKQBbXjRuagsv7vffJ/ZfHOyfSsWdImCi25.i9Be'),
('LL','Lorena Leticia','rewind','$2a$12$C9Ru1EyRCO9b1NnXAsBt2u7mmxEhBPLwQ./E.PvtOtl7GqrSo0htO')
on conflict(username) do nothing;
alter table public.prisma_orders add column if not exists press_operator text references public.prisma_operators(username);
alter table public.prisma_orders add column if not exists rewind_operator text references public.prisma_operators(username);
alter table public.prisma_orders add column if not exists rewind_claimed_by text references public.prisma_operators(username);
alter table public.prisma_orders add column if not exists rewind_claimed_at timestamptz;
create or replace function public.prisma_assigned_pressman(value text) returns text language sql immutable set search_path=public,pg_temp as $$select case lower(regexp_replace(btrim(coalesce(value,'')),'\s+',' ','g')) when 'julio' then 'JRU' when 'julio rocha' then 'JRU' when 'jru' then 'JRU' when 'manuel' then 'MCR' when 'manuel carrillo' then 'MCR' when 'mcr' then 'MCR' end$$;
update public.prisma_orders set press_operator=public.prisma_assigned_pressman(pressman) where press_operator is null and public.prisma_assigned_pressman(pressman) is not null;
create or replace function public.prisma_operator_scope(access_key text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid;stage text;
begin
 if access_key is null or access_key !~ '^(ps|rw|pq|rq)_[a-f0-9]{64}$' then raise exception 'Enlace no autorizado.';end if;
 stage:=case when left(access_key,2) in ('ps','pq') then 'production' else 'rewind' end;
 if left(access_key,2) in ('pq','rq') then select q.profile_id into owner_id from public.prisma_press_queues q where q.production_key=access_key or q.rewind_key=access_key;
 else select s.profile_id into owner_id from public.prisma_press_sheets s where s.access_key=prisma_operator_scope.access_key or s.rewind_key=prisma_operator_scope.access_key;end if;
 if owner_id is null then raise exception 'Enlace no autorizado.';end if;return jsonb_build_object('profile_id',owner_id,'stage',stage);
end $$;
create or replace function public.prisma_operator_identity(access_key text,session_key text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare scope jsonb;person public.prisma_operators%rowtype;
begin
 scope:=public.prisma_operator_scope(access_key);
 if coalesce(session_key,'')<>'' then
  select o.* into person from public.prisma_operator_sessions s join public.prisma_operators o on o.username=s.username where s.session_hash=encode(sha256(convert_to(session_key,'UTF8')),'hex') and s.profile_id=(scope->>'profile_id')::uuid and s.expires_at>now() and o.enabled and o.stage=scope->>'stage';
  if found then return scope||jsonb_build_object('authenticated',true,'is_manager',false,'username',person.username,'name',person.name,'workflow_version',4);end if;
 elsif auth.uid() is not null then
  perform public.prisma_authorize();
  if (auth.uid()=(scope->>'profile_id')::uuid or exists(select 1 from public.prisma_admins where user_id=auth.uid())) and (public.prisma_has_permission(auth.uid(),'production') or public.prisma_has_permission(auth.uid(),'preparation')) then return scope||jsonb_build_object('authenticated',true,'is_manager',true,'name','Administración','workflow_version',4);end if;
 end if;
 return jsonb_build_object('authenticated',false,'stage',scope->>'stage','workflow_version',4);
end $$;
create or replace function public.prisma_operator_password_matches(candidate text,stored text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare extension_schema text;matches boolean;
begin select n.nspname into extension_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto';if extension_schema is null then raise exception 'Falta activar pgcrypto.';end if;execute format('select %I.crypt($1,$2)=$2',extension_schema) into matches using candidate,stored;return matches;end $$;
create or replace function public.prisma_operator_access(access_key text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare scope jsonb;person public.prisma_operators%rowtype;secret text;username_value text:=upper(btrim(coalesce(payload->>'username','')));candidate text:=payload->>'password';
begin
 scope:=public.prisma_operator_scope(access_key);
 if payload->>'operation'='context' then return public.prisma_operator_identity(access_key,payload->>'session_key');end if;
 if payload->>'operation'='logout' then delete from public.prisma_operator_sessions where session_hash=encode(sha256(convert_to(coalesce(payload->>'session_key',''),'UTF8')),'hex') and profile_id=(scope->>'profile_id')::uuid;return jsonb_build_object('authenticated',false,'stage',scope->>'stage','workflow_version',4);end if;
 if payload->>'operation' is distinct from 'login' then raise exception 'Acción no válida.';end if;
 select * into person from public.prisma_operators o where o.username=username_value for update;
 if not found then perform public.prisma_operator_password_matches(left(coalesce(candidate,''),128),(select password_hash from public.prisma_operators where username='MCR'));return jsonb_build_object('error','Usuario o contraseña incorrectos para esta área.');end if;
 if person.window_started<now()-interval '10 minutes' then update public.prisma_operators set failed_attempts=0,window_started=now() where username=person.username returning * into person;end if;
 if person.failed_attempts>=10 then return jsonb_build_object('error','Demasiados intentos. Intenta nuevamente en 10 minutos.');end if;
 if candidate is null or length(candidate)>128 or not public.prisma_operator_password_matches(candidate,person.password_hash) or not person.enabled or person.stage<>scope->>'stage' then update public.prisma_operators set failed_attempts=failed_attempts+1 where username=person.username;return jsonb_build_object('error','Usuario o contraseña incorrectos para esta área.');end if;
 update public.prisma_operators set failed_attempts=0 where username=person.username;delete from public.prisma_operator_sessions where expires_at<=now();secret:='os_'||encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex');
 insert into public.prisma_operator_sessions(session_hash,username,profile_id,expires_at) values(encode(sha256(convert_to(secret,'UTF8')),'hex'),person.username,(scope->>'profile_id')::uuid,now()+interval '12 hours');
 return public.prisma_operator_identity(access_key,secret)||jsonb_build_object('session_key',secret,'expires_at',now()+interval '12 hours');
end $$;
do $$begin
 if to_regprocedure('public.prisma_press_sheet_profiles_internal(text,jsonb)') is null then alter function public.prisma_press_sheet(text,jsonb) rename to prisma_press_sheet_profiles_internal;end if;
 if to_regprocedure('public.prisma_press_queue_profiles_internal(text)') is null then alter function public.prisma_press_queue(text) rename to prisma_press_queue_profiles_internal;end if;
 if to_regprocedure('public.prisma_order_portal_profiles_internal(text,jsonb)') is null then alter function public.prisma_order_portal(text,jsonb) rename to prisma_order_portal_profiles_internal;end if;
 if to_regprocedure('public.prisma_production_audit_profiles_internal(jsonb)') is null then alter function public.prisma_production_audit(jsonb) rename to prisma_production_audit_profiles_internal;end if;
 if to_regprocedure('public.prisma_press_sheets_profiles_internal(jsonb)') is null then alter function public.prisma_press_sheets(jsonb) rename to prisma_press_sheets_profiles_internal;end if;
 execute replace(pg_get_functiondef('public.prisma_press_sheet_profiles_internal(text,jsonb)'::regprocedure),'prisma_press_sheet.access_key','prisma_press_sheet_profiles_internal.access_key');
 execute replace(pg_get_functiondef('public.prisma_press_queue_profiles_internal(text)'::regprocedure),'prisma_press_queue.access_key','prisma_press_queue_profiles_internal.access_key');
end $$;
revoke all on function public.prisma_operator_scope(text),public.prisma_operator_identity(text,text),public.prisma_operator_password_matches(text,text),public.prisma_assigned_pressman(text),public.prisma_press_sheet_profiles_internal(text,jsonb),public.prisma_press_queue_profiles_internal(text),public.prisma_order_portal_profiles_internal(text,jsonb),public.prisma_press_sheets_profiles_internal(jsonb),public.prisma_production_audit_profiles_internal(jsonb) from public,anon,authenticated;
create or replace function public.prisma_press_sheet(access_key text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor jsonb;sheet public.prisma_press_sheets%rowtype;o public.prisma_orders%rowtype;result jsonb;idx integer;before_row jsonb;rows jsonb;verified_field text;
begin
 actor:=public.prisma_operator_identity(access_key,payload->>'session_key');if not (actor->>'authenticated')::boolean then raise exception 'Inicia sesión con tu usuario del área.';end if;
 perform pg_advisory_xact_lock(104202611);
 select * into sheet from public.prisma_press_sheets s where s.access_key=prisma_press_sheet.access_key or s.rewind_key=prisma_press_sheet.access_key for update;if not found then raise exception 'Enlace no autorizado.';end if;
 select * into o from public.prisma_orders where id=sheet.order_id for update;
 if not (actor->>'is_manager')::boolean then
  if actor->>'stage'='production' then
   if coalesce(o.press_operator,public.prisma_assigned_pressman(o.pressman),'')<>actor->>'username' or (sheet.runtime->>'operator_username' is not null and sheet.runtime->>'operator_username'<>actor->>'username') then raise exception 'Esta orden no está asignada a tu perfil.';end if;
  elsif o.rewind_operator is not null and o.rewind_operator<>actor->>'username' then raise exception 'Esta orden no está asignada a tu perfil.';end if;
 end if;
 if payload->>'operation'='claim' then
  if actor->>'stage'<>'rewind' or (actor->>'is_manager')::boolean or o.status='cancelled' or not exists(select 1 from jsonb_array_elements(sheet.bobinas) b where b->>'produced_at' is not null) then raise exception 'Esta orden no está disponible para tomar.';end if;
  update public.prisma_orders set rewind_operator=actor->>'username',rewind_claimed_by=coalesce(rewind_claimed_by,actor->>'username'),rewind_claimed_at=coalesce(rewind_claimed_at,now()) where id=o.id returning * into o;update public.prisma_press_sheets set fields=fields||jsonb_build_object('rewind_signature',actor->>'name'),version=version+1 where id=sheet.id;payload:=jsonb_set(payload,'{operation}','"get"');
 elsif actor->>'stage'='rewind' and payload->>'operation'<>'get' and not (actor->>'is_manager')::boolean and o.rewind_claimed_by is distinct from actor->>'username' then raise exception 'Pulsa Iniciar rebobinado para tomar la orden.';
 end if;
 if payload->>'operation'='save' and not (actor->>'is_manager')::boolean then payload:=jsonb_set(payload,'{fields}',coalesce(payload->'fields','{}')||jsonb_build_object(case when actor->>'stage'='production' then 'press_signature' else 'rewind_signature' end,actor->>'name'));end if;
 if payload->>'operation'='complete_bobina' then idx:=(payload->>'number')::integer-1;before_row:=sheet.bobinas->idx;end if;
 result:=public.prisma_press_sheet_profiles_internal(access_key,payload);
 if not (actor->>'is_manager')::boolean then
  if actor->>'stage'='production' and payload->>'operation'<>'get' then update public.prisma_press_sheets set fields=fields||jsonb_build_object('press_signature',actor->>'name'),runtime=runtime||jsonb_build_object('operator_username',actor->>'username','operator_name',actor->>'name','operator_verified_at',now()) where id=sheet.id and runtime->>'started_at' is not null and runtime->>'operator_username' is null;end if;
  if payload->>'operation'='complete_bobina' and before_row is not null then
   verified_field:=case when actor->>'stage'='production' then 'produced_at' else 'rewound_at' end;
   if before_row->>verified_field is null then
    select bobinas into rows from public.prisma_press_sheets where id=sheet.id;
    rows:=jsonb_set(rows,array[idx::text],(rows->idx)||case when actor->>'stage'='production' then jsonb_build_object('produced_by',actor->>'username','produced_by_name',actor->>'name') else jsonb_build_object('rewound_by',actor->>'username','rewound_by_name',actor->>'name') end);
    update public.prisma_press_sheets set bobinas=rows where id=sheet.id;result:=public.prisma_press_sheet_profiles_internal(access_key,jsonb_build_object('operation','get'));
   end if;
  end if;
 end if;
 result:=public.prisma_press_sheet_profiles_internal(access_key,jsonb_build_object('operation','get'));
 return result||jsonb_build_object('workflow_version',4,'actor',actor-'profile_id','needs_claim',actor->>'stage'='rewind' and not (actor->>'is_manager')::boolean and o.rewind_claimed_at is null);
end $$;
create or replace function public.prisma_operator_queue(access_key text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor jsonb;result jsonb;filtered jsonb;
begin
 actor:=public.prisma_operator_identity(access_key,payload->>'session_key');if not (actor->>'authenticated')::boolean then raise exception 'Inicia sesión con tu usuario del área.';end if;
 result:=public.prisma_press_queue_profiles_internal(access_key);
 select coalesce(jsonb_agg(entry.j||jsonb_build_object('needs_claim',actor->>'stage'='rewind' and not (actor->>'is_manager')::boolean and o.rewind_claimed_at is null) order by s.id),'[]') into filtered from jsonb_array_elements(result->'sheets') as entry(j) join public.prisma_press_sheets s on s.id=(entry.j->>'id')::bigint join public.prisma_orders o on o.id=s.order_id where (actor->>'is_manager')::boolean or (case when actor->>'stage'='production' then coalesce(o.press_operator,public.prisma_assigned_pressman(o.pressman),'')=actor->>'username' else o.rewind_operator is null or o.rewind_operator=actor->>'username' end);
 return result||jsonb_build_object('workflow_version',4,'actor',actor-'profile_id','sheets',filtered);
end $$;
-- El endpoint anterior tampoco permite saltarse el inicio de sesión.
create or replace function public.prisma_press_queue(access_key text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$begin return public.prisma_operator_queue(access_key,'{}');end $$;
create or replace function public.prisma_order_portal(access_key text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;press text;rewind text;stored public.prisma_orders%rowtype;
begin
 if payload->>'operation'='submit' then
  select username into press from public.prisma_operators where name=payload->'order'->>'pressman' and stage='production' and enabled;
  select username into rewind from public.prisma_operators where username=payload->'order'->>'rewind_operator' and stage='rewind' and enabled;
  if press is null or rewind is null then raise exception 'Selecciona el perfil del prensista y de rebobinado en la captura.';end if;
 end if;
 result:=public.prisma_order_portal_profiles_internal(access_key,payload);
 if payload->>'operation'='submit' then
  select * into stored from public.prisma_orders where id=(result->>'id')::bigint;
  if coalesce((result->>'duplicate')::boolean,false) and (stored.press_operator is distinct from press or stored.rewind_operator is distinct from rewind) then raise exception 'La captura ya fue enviada con otra asignación.';end if;
  update public.prisma_orders set press_operator=press,rewind_operator=rewind where id=stored.id;
 end if;return result||jsonb_build_object('production_workflow_version',4);
end $$;
create or replace function public.prisma_operator_assign(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.prisma_orders%rowtype;s public.prisma_press_sheets%rowtype;press public.prisma_operators%rowtype;rewind public.prisma_operators%rowtype;
begin
 perform public.prisma_authorize();if not public.prisma_has_permission(auth.uid(),'preparation') and not public.prisma_has_permission(auth.uid(),'production') then raise exception 'No tienes permiso para asignar órdenes.';end if;perform pg_advisory_xact_lock(104202611);
 select * into s from public.prisma_press_sheets where order_id=(payload->>'order_id')::bigint for update;if not found or (s.profile_id<>auth.uid() and not exists(select 1 from public.prisma_admins where user_id=auth.uid())) then raise exception 'Orden no autorizada.';end if;
 select * into o from public.prisma_orders where id=s.order_id for update;
 select * into press from public.prisma_operators where username=payload->>'press_operator' and stage='production' and enabled;if not found then raise exception 'Selecciona el prensista.';end if;
 select * into rewind from public.prisma_operators where username=payload->>'rewind_operator' and stage='rewind' and enabled;if not found then raise exception 'Selecciona rebobinado.';end if;
 if coalesce(o.press_operator,public.prisma_assigned_pressman(o.pressman),'')<>press.username and (s.runtime->>'started_at' is not null or exists(select 1 from jsonb_array_elements(s.bobinas) b where b->>'produced_at' is not null)) then raise exception 'La producción ya comenzó. Se conserva su responsable.';end if;
 if o.rewind_operator is distinct from rewind.username and o.rewind_claimed_at is not null then raise exception 'Rebobinado ya tomó la orden. Se conserva su responsable.';end if;
 update public.prisma_orders set press_operator=press.username,pressman=press.name,rewind_operator=rewind.username where id=o.id;update public.prisma_press_sheets set source=jsonb_set(source,'{pressman}',to_jsonb(press.name)) where id=s.id;return jsonb_build_object('ok',true);
end $$;
create or replace function public.prisma_press_sheets(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;rows jsonb;
begin result:=public.prisma_press_sheets_profiles_internal(payload);
 if payload->>'operation'='list' then
  select coalesce(jsonb_agg(entry.j||jsonb_build_object('press_operator',coalesce(o.press_operator,public.prisma_assigned_pressman(o.pressman)),'rewind_operator',o.rewind_operator,'rewind_claimed_by',o.rewind_claimed_by) order by (entry.j->>'id')::bigint desc),'[]') into rows from jsonb_array_elements(result->'sheets') as entry(j) join public.prisma_orders o on o.id=(entry.j->>'order_id')::bigint;return (result-'sheets')||jsonb_build_object('sheets',rows,'operator_profiles_version',4);
 end if;return result;
end $$;
create or replace function public.prisma_production_audit(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;rows jsonb;
begin result:=public.prisma_production_audit_profiles_internal(payload);
 select coalesce(jsonb_agg(entry.j||jsonb_build_object('performed_by',s.runtime->>'operator_name','performed_username',s.runtime->>'operator_username') order by s.id desc),'[]') into rows from jsonb_array_elements(result->'sessions') entry(j) join public.prisma_press_sheets s on s.id=(entry.j->>'id')::bigint;
 return (result-'sessions')||jsonb_build_object('sessions',rows);
end $$;
revoke all on function public.prisma_production_audit(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_production_audit(jsonb) to authenticated;
revoke all on function public.prisma_operator_access(text,jsonb),public.prisma_operator_queue(text,jsonb),public.prisma_press_sheet(text,jsonb),public.prisma_press_queue(text),public.prisma_order_portal(text,jsonb),public.prisma_operator_assign(jsonb),public.prisma_press_sheets(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_operator_access(text,jsonb),public.prisma_operator_queue(text,jsonb),public.prisma_press_sheet(text,jsonb),public.prisma_press_queue(text),public.prisma_order_portal(text,jsonb) to anon,authenticated;
grant execute on function public.prisma_operator_assign(jsonb),public.prisma_press_sheets(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
