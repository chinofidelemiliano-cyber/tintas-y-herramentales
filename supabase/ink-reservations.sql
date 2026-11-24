begin;

create table if not exists public.prisma_ink_reservations (
 order_id bigint not null references public.prisma_orders(id),
 lot_id bigint not null references public.prisma_lots(id),
 grams numeric(16,3) not null check (grams>0),
 primary key(order_id,lot_id)
);
create index if not exists prisma_ink_reservations_lot on public.prisma_ink_reservations(lot_id);
alter table public.prisma_ink_reservations enable row level security;
revoke all on public.prisma_ink_reservations from public,anon,authenticated;

create or replace function public.prisma_ink_reservation_stock_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare reserved numeric;
begin
 if new.grams>=old.grams then return new; end if;
 select sum(grams) into reserved from public.prisma_ink_reservations where lot_id=old.id;
 if reserved is not null and new.grams<reserved then
  raise exception 'El lote % tiene % g reservados para otras órdenes.',old.lot,reserved;
 end if;
 return new;
end $$;
revoke all on function public.prisma_ink_reservation_stock_guard() from public,anon,authenticated;
drop trigger if exists prisma_ink_reservation_stock_guard on public.prisma_lots;
create trigger prisma_ink_reservation_stock_guard before update of grams on public.prisma_lots
 for each row execute function public.prisma_ink_reservation_stock_guard();

create or replace function public.prisma_ink_reservation_reconcile() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare removed jsonb;
begin
 with discarded as (
  delete from public.prisma_ink_reservations r
  using public.prisma_lots l
  where r.order_id=new.id and l.id=r.lot_id and
   (new.status<>'draft' or not exists(select 1 from jsonb_array_elements(new.ink_selections) j
    where nullif(j->>'product_id','')::bigint=l.product_id))
  returning r.lot_id,r.grams
 )
 select jsonb_agg(to_jsonb(discarded) order by lot_id) into removed from discarded;
 if removed is not null and auth.uid() is not null then
  insert into public.prisma_preparation_audit(order_id,actor,operation,reason,before_value,after_value)
   values(new.id,auth.uid(),'release_reservations','Cambio de tintas o cierre de la orden',removed,'[]');
 end if;
 return new;
end $$;
revoke all on function public.prisma_ink_reservation_reconcile() from public,anon,authenticated;
drop trigger if exists prisma_ink_reservation_reconcile on public.prisma_orders;
create trigger prisma_ink_reservation_reconcile before update of status,ink_selections on public.prisma_orders
 for each row when (new.status is distinct from old.status or new.ink_selections is distinct from old.ink_selections)
 execute function public.prisma_ink_reservation_reconcile();

create or replace function public.prisma_manage_ink_reservations(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 o public.prisma_orders%rowtype;
 op text:=payload->>'operation';
 entries jsonb:=payload->'reservations';
 row_value jsonb;
 current_values jsonb;
 next_values jsonb;
 revision text;
 chosen bigint;
 amount numeric;
 lot public.prisma_lots%rowtype;
 available numeric;
 eligible jsonb;
 claimed bigint[]:=array[]::bigint[];
 reason text:=trim(coalesce(payload->>'reason',''));
begin
 perform public.prisma_require_permission('preparation');
 perform public.prisma_require_permission('preparation_edit');
 if op='save' then perform pg_advisory_xact_lock(104202611); end if;
 select * into o from public.prisma_orders where id=(payload->>'id')::bigint;
 if not found or o.status<>'draft' then raise exception 'Selecciona una orden pendiente.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('lot_id',lot_id,'grams',grams) order by lot_id),'[]')
  into current_values from public.prisma_ink_reservations where order_id=o.id;
 revision:=md5((to_jsonb(o)||jsonb_build_object('reservations',current_values))::text);
 if op='save' then
  if payload->>'revision' is distinct from revision then raise exception 'La orden o sus reservas cambiaron. Abre de nuevo la edición.'; end if;
  if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries)>50 or length(reason) not between 1 and 1000 then
   raise exception 'Revisa las reservas y el motivo.';
  end if;
  for row_value in select value from jsonb_array_elements(entries) order by (value->>'lot_id')::bigint loop
   chosen:=(row_value->>'lot_id')::bigint;
   if coalesce(row_value->>'grams','') !~ '^[0-9]+([.][0-9]{1,3})?$' then raise exception 'Cantidad reservada no válida.'; end if;
   amount:=(row_value->>'grams')::numeric;
   if chosen is null or chosen=any(claimed) or amount<=0 or amount>9999999999999 then
    raise exception 'Revisa cantidades y lotes repetidos.';
   end if;
   claimed:=array_append(claimed,chosen);
   select * into lot from public.prisma_lots l where l.id=chosen and exists(
    select 1 from jsonb_array_elements(o.ink_selections) ink where (ink->>'product_id')::bigint=l.product_id) for update;
   if not found then raise exception 'El lote no corresponde a una tinta seleccionada en la orden.'; end if;
   select lot.grams-coalesce(sum(grams),0) into available from public.prisma_ink_reservations where lot_id=chosen and order_id<>o.id;
   if amount>available then raise exception 'Existencia disponible insuficiente en el lote %.',lot.lot; end if;
  end loop;
  delete from public.prisma_ink_reservations where order_id=o.id;
  insert into public.prisma_ink_reservations(order_id,lot_id,grams)
   select o.id,(j->>'lot_id')::bigint,(j->>'grams')::numeric from jsonb_array_elements(entries) j;
  select coalesce(jsonb_agg(jsonb_build_object('lot_id',lot_id,'grams',grams) order by lot_id),'[]')
   into next_values from public.prisma_ink_reservations where order_id=o.id;
  if next_values is distinct from current_values then
   insert into public.prisma_preparation_audit(order_id,actor,operation,reason,before_value,after_value)
    values(o.id,auth.uid(),'reserve_inks',reason,current_values,next_values);
  end if;
  return jsonb_build_object('id',o.id);
 elsif op is distinct from 'get' then raise exception 'Acción no válida.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',p.name,'lot',l.lot,
  'available',greatest(0,l.grams-coalesce((select sum(r.grams) from public.prisma_ink_reservations r where r.lot_id=l.id and r.order_id<>o.id),0)))
  order by p.name,l.lot),'[]') into eligible
 from public.prisma_lots l join public.prisma_products p on p.id=l.product_id
 where exists(select 1 from jsonb_array_elements(o.ink_selections) ink where (ink->>'product_id')::bigint=l.product_id);
 return jsonb_build_object('revision',revision,'reservations',current_values,'lots',eligible);
end $$;
revoke all on function public.prisma_manage_ink_reservations(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_manage_ink_reservations(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
