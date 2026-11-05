-- Ejecutar después de order-status-and-comments.sql. No cambia el enlace de consulta.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.prisma_order_status_credentials(id integer primary key check(id=1),username text not null,password_hash text not null,failed_attempts integer not null default 0,window_started timestamptz not null default now());
create table if not exists public.prisma_order_status_sessions(session_hash text primary key,link_hash text not null,expires_at timestamptz not null);
alter table public.prisma_order_status_credentials enable row level security;
alter table public.prisma_order_status_sessions enable row level security;
revoke all on public.prisma_order_status_credentials,public.prisma_order_status_sessions from public,anon,authenticated;
insert into public.prisma_order_status_credentials(id,username,password_hash) values(1,'1','$2a$10$kOAYBoFCphHMgWTVJlbLjun2o02Sm5MOiwXmHuL5KOMU0kzkvXVfW') on conflict(id) do nothing;
create or replace function public.prisma_status_password_matches(candidate text,stored_hash text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare extension_schema text;matches boolean;
begin
 select n.nspname into extension_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto';
 if extension_schema is null then raise exception 'Falta activar pgcrypto.';end if;
 execute format('select %I.crypt($1,$2)=$2',extension_schema) into matches using candidate,stored_hash;return matches;
end $$;
create or replace function public.prisma_order_status_login(access_key text,login_user text,login_password text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare credential public.prisma_order_status_credentials%rowtype;secret text;link_digest text;
begin
 link_digest:=encode(sha256(convert_to(coalesce(access_key,''),'UTF8')),'hex');
 if access_key is null or access_key !~ '^st_[a-f0-9]{64}$' or not exists(select 1 from public.prisma_order_status_access where id=1 and enabled and token_hash=link_digest) then return jsonb_build_object('error','El enlace de consulta no está autorizado o fue desactivado.');end if;
 select * into credential from public.prisma_order_status_credentials where id=1 for update;
 if not found then return jsonb_build_object('error','Falta configurar el acceso de consulta.');end if;
 if credential.window_started<now()-interval '10 minutes' then update public.prisma_order_status_credentials set failed_attempts=0,window_started=now() where id=1 returning * into credential;end if;
 if credential.failed_attempts>=10 then return jsonb_build_object('error','Demasiados intentos. Intenta nuevamente en 10 minutos.');end if;
 if login_user is null or login_password is null or length(login_user)>100 or length(login_password)>128 or btrim(login_user)<>credential.username or not public.prisma_status_password_matches(login_password,credential.password_hash) then update public.prisma_order_status_credentials set failed_attempts=failed_attempts+1 where id=1;return jsonb_build_object('error','Usuario o contraseña incorrectos.');end if;
 update public.prisma_order_status_credentials set failed_attempts=0,window_started=now() where id=1;
 delete from public.prisma_order_status_sessions where expires_at<=now();
 secret:='ss_'||encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex');
 insert into public.prisma_order_status_sessions values(encode(sha256(convert_to(secret,'UTF8')),'hex'),link_digest,now()+interval '1 hour');
 return jsonb_build_object('session_key',secret,'expires_at',now()+interval '1 hour');
end $$;
do $$begin
 if to_regprocedure('public.prisma_order_status_read_internal(text,text)') is null then alter function public.prisma_order_status(text,text) rename to prisma_order_status_read_internal;end if;
end $$;
-- Close the old two-argument route as well if an older migration was rerun later.
revoke all on function public.prisma_order_status_read_internal(text,text) from public,anon,authenticated;
drop function if exists public.prisma_order_status(text,text);
create or replace function public.prisma_order_status(access_key text,target_month text,session_key text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if session_key is null or not exists(select 1 from public.prisma_order_status_sessions where session_hash=encode(sha256(convert_to(session_key,'UTF8')),'hex') and link_hash=encode(sha256(convert_to(coalesce(access_key,''),'UTF8')),'hex') and expires_at>now()) then raise exception 'Inicia sesión para consultar las órdenes.';end if;
 return public.prisma_order_status_read_internal(access_key,target_month);
end $$;
create or replace function public.prisma_order_status_logout(session_key text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin delete from public.prisma_order_status_sessions where session_hash=encode(sha256(convert_to(coalesce(session_key,''),'UTF8')),'hex');return jsonb_build_object('ok',true);end $$;
revoke all on function public.prisma_status_password_matches(text,text),public.prisma_order_status_login(text,text,text),public.prisma_order_status(text,text,text),public.prisma_order_status_logout(text) from public,anon,authenticated;
grant execute on function public.prisma_order_status_login(text,text,text),public.prisma_order_status(text,text,text),public.prisma_order_status_logout(text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
