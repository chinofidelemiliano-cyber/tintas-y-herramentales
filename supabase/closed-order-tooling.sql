begin;

create or replace function public.prisma_closed_order_tooling(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 o public.prisma_orders%rowtype;
 tool public.prisma_products%rowtype;
 op text:=payload->>'operation';
 kind text:=payload->>'kind';
 id_key text;
 prefix text;
 revision text;
 original jsonb;
 updated jsonb;
 specs jsonb;
 history jsonb;
 reason text:=trim(coalesce(payload->>'reason',''));
 selection text:=payload->>'product_id';
begin
 perform public.prisma_require_permission('production');
 perform public.prisma_require_permission('preparation_edit');
 if kind='suaje' then id_key:='die_id';prefix:='SJ';
 elsif kind='pleca' then id_key:='crease_id';prefix:='PD';
 else raise exception 'Herramental no válido.'; end if;
 if op='save' then
  perform pg_advisory_xact_lock(104202611);
  select * into o from public.prisma_orders where id=(payload->>'id')::bigint for update;
 else
  select * into o from public.prisma_orders where id=(payload->>'id')::bigint;
 end if;
 if not found or o.status<>'confirmed' or o.specifications->'production_plan'->>'production_type'='print' then
  raise exception 'Selecciona una orden cerrada que incluya corte.';
 end if;
 original:=jsonb_build_object('product_id',o.specifications->id_key,'label',o.specifications->kind);
 revision:=md5(to_jsonb(o)::text);
 if op='get' then
  select coalesce(jsonb_agg(jsonb_build_object('actor',coalesce(nullif(p.preferences->>'reportName',''),u.email,a.actor::text),'at',a.recorded_at,'reason',a.reason,
   'before',a.before_value,'after',a.after_value) order by a.id desc),'[]') into history
  from public.prisma_preparation_audit a left join auth.users u on u.id=a.actor
  left join public.prisma_user_preferences p on p.user_id=a.actor
  where a.order_id=o.id and a.operation='correct_closed_'||kind;
  return original||jsonb_build_object('revision',revision,'history',history);
 end if;
 if op is distinct from 'save' then raise exception 'Acción no válida.'; end if;
 if payload->>'revision' is distinct from revision then raise exception 'La orden cambió. Abre de nuevo la corrección.'; end if;
 if length(reason) not between 1 and 1000 then raise exception 'Indica el motivo de la corrección.'; end if;
 specs:=o.specifications-array[id_key,kind];
 if selection is not null then
  if selection !~ '^[1-9][0-9]*$' then raise exception 'Selecciona un herramental válido.'; end if;
  select * into tool from public.prisma_products where id=selection::bigint and category='herramental' and code like prefix||'%';
  if not found then raise exception 'Selecciona un herramental válido del catálogo.'; end if;
  specs:=specs||jsonb_build_object(id_key,tool.id,kind,tool.code||' · '||tool.name);
 elsif payload->>'unidentified' is distinct from 'true' then
  raise exception 'Selecciona un herramental o marca por identificar.';
 end if;
 updated:=jsonb_build_object('product_id',specs->id_key,'label',specs->kind);
 if updated is distinct from original then
  update public.prisma_orders set specifications=specs where id=o.id;
  insert into public.prisma_preparation_audit(order_id,actor,operation,reason,before_value,after_value)
  values(o.id,auth.uid(),'correct_closed_'||kind,reason,original,updated);
 end if;
 return updated;
end $$;
revoke all on function public.prisma_closed_order_tooling(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_closed_order_tooling(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
