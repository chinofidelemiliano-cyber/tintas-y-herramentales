-- Ejecutar después de las migraciones actuales de perfil, cuentas y consulta mensual.
begin;
create table if not exists public.prisma_site_time_settings(id integer primary key check(id=1),time_zone text not null default 'America/Mexico_City',time_format text not null default '24',updated_at timestamptz not null default now());
alter table public.prisma_site_time_settings enable row level security;
revoke all on public.prisma_site_time_settings from public,anon,authenticated;
insert into public.prisma_site_time_settings(id) values(1) on conflict do nothing;
create or replace function public.prisma_public_time_settings() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$select jsonb_build_object('timezoneMode','custom','timeZone',time_zone,'timeFormat',time_format) from public.prisma_site_time_settings where id=1$$;
create or replace function public.prisma_publish_profile_time() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare zone text:=new.preferences->>'timeZone';clock_format text:=new.preferences->>'timeFormat';
begin
 if zone is null then return new;end if;
 if not exists(select 1 from pg_timezone_names where name=zone) or coalesce(clock_format,'24') not in ('12','24') then raise exception 'Zona horaria o formato no válido.';end if;
 if exists(select 1 from public.prisma_admins where user_id=new.user_id) then update public.prisma_site_time_settings set time_zone=zone,time_format=coalesce(clock_format,'24'),updated_at=now() where id=1;end if;
 return new;
end $$;
drop trigger if exists prisma_publish_profile_time on public.prisma_user_preferences;
create trigger prisma_publish_profile_time after insert or update on public.prisma_user_preferences for each row execute function public.prisma_publish_profile_time();
update public.prisma_site_time_settings set time_zone=p.zone,time_format=p.format from (select u.preferences->>'timeZone' as zone,case when u.preferences->>'timeFormat'='12' then '12' else '24' end as format from public.prisma_user_preferences u join public.prisma_admins a on a.user_id=u.user_id where exists(select 1 from pg_timezone_names where name=u.preferences->>'timeZone') order by u.updated_at desc limit 1)p where id=1;
-- Today's date follows the caller's chosen zone, or the shared site clock for external pages.
create or replace function public.prisma_today() returns date language plpgsql stable security definer set search_path=public,pg_temp as $$
declare zone text;headers jsonb;preferences jsonb;
begin
 headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;zone:=substring(headers->>'x-client-info' from 'time-zone=([^; ]+)');
 if zone is null or not exists(select 1 from pg_timezone_names where name=zone) then select p.preferences into preferences from public.prisma_user_preferences p where p.user_id=auth.uid();zone:=preferences->>'timeZone';end if;
 if zone is null or not exists(select 1 from pg_timezone_names where name=zone) then select time_zone into zone from public.prisma_site_time_settings where id=1;end if;
 return timezone(coalesce(zone,'America/Mexico_City'),now())::date;
end $$;
do $$begin
 if to_regprocedure('public.prisma_order_portal_time_internal(text,jsonb)') is null then alter function public.prisma_order_portal(text,jsonb) rename to prisma_order_portal_time_internal;end if;
 if to_regprocedure('public.prisma_order_status_time_internal(text,text,text)') is null then alter function public.prisma_order_status(text,text,text) rename to prisma_order_status_time_internal;end if;
end $$;
revoke all on function public.prisma_public_time_settings(),public.prisma_publish_profile_time(),public.prisma_order_portal_time_internal(text,jsonb),public.prisma_order_status_time_internal(text,text,text) from public,anon,authenticated;
create or replace function public.prisma_order_portal(access_key text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin return public.prisma_order_portal_time_internal(access_key,payload)||jsonb_build_object('time_settings',public.prisma_public_time_settings());end $$;
create or replace function public.prisma_order_status(access_key text,target_month text,session_key text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin return public.prisma_order_status_time_internal(access_key,target_month,session_key)||jsonb_build_object('time_settings',public.prisma_public_time_settings());end $$;
revoke all on function public.prisma_order_portal(text,jsonb),public.prisma_order_status(text,text,text) from public,anon,authenticated;
grant execute on function public.prisma_order_portal(text,jsonb),public.prisma_order_status(text,text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
