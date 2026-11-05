-- SOLO si tu cuenta personal todavía no aparece como administradora.
-- Primero crea/verifica tu cuenta; luego ejecuta este archivo desde SQL Editor.
begin;
do $$
declare owner_id uuid;
begin
 select id into owner_id from auth.users where lower(email)='chinofidelemiliano@gmail.com' and email_confirmed_at is not null;
 if owner_id is null then raise exception 'Primero crea y verifica la cuenta chinofidelemiliano@gmail.com.';end if;
 insert into public.prisma_members(user_id) values(owner_id) on conflict(user_id) do nothing;
 insert into public.prisma_admins(user_id) values(owner_id) on conflict(user_id) do nothing;
end $$;
commit;
