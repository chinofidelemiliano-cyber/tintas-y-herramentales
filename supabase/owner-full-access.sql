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
