-- Ejecuta este archivo completo una sola vez en SQL Editor.
-- Configuración privada por cuenta; no modifica existencias ni movimientos.
begin;
create table if not exists public.prisma_user_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 preferences jsonb not null check (jsonb_typeof(preferences)='object' and octet_length(preferences::text)<=500000),
 updated_at timestamptz not null default now()
);
alter table public.prisma_user_preferences enable row level security;
revoke all on public.prisma_user_preferences from public,anon,authenticated;
create or replace function public.prisma_get_preferences() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 perform public.prisma_authorize();
 select preferences into result from public.prisma_user_preferences where user_id=auth.uid();
 return result;
end $$;
create or replace function public.prisma_save_preferences(payload jsonb,only_if_missing boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 perform public.prisma_authorize();
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>500000 then
  raise exception 'Configuración no válida o demasiado grande.';
 end if;
 insert into public.prisma_user_preferences(user_id,preferences) values(auth.uid(),payload)
 on conflict(user_id) do update set preferences=excluded.preferences,updated_at=now()
 where not coalesce(only_if_missing,false);
 select preferences into result from public.prisma_user_preferences where user_id=auth.uid();
 return result;
end $$;
revoke all on function public.prisma_get_preferences(),public.prisma_save_preferences(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.prisma_get_preferences(),public.prisma_save_preferences(jsonb,boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
