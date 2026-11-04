-- Primero: Authentication → Users → Add user → Create new user.
-- Crea tu cuenta con correo y contraseña propios; no los compartas por chat.
-- Después sustituye SOLO el correo de abajo y ejecuta este archivo en SQL Editor.
do $$
declare account_email text := 'CAMBIA_POR_TU_CORREO'; account_id uuid;
begin
 select id into account_id from auth.users where lower(email)=lower(account_email);
 if account_id is null then raise exception 'No existe ese correo en Authentication → Users. Crea el usuario primero.';end if;
 insert into public.prisma_members(user_id) values(account_id) on conflict do nothing;
end $$;
