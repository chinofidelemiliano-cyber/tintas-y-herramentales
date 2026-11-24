begin;
create or replace function public.prisma_preparation_indicator_events(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare month_start date; result jsonb;
begin
 perform public.prisma_require_permission('preparation');
 if coalesce(payload->>'month','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Mes no válido.'; end if;
 month_start:=(payload->>'month'||'-01')::date;
 with orders as (
  select o.id,o.ended_at,c.responsible
  from public.prisma_orders o join public.prisma_preparation_clocks c on c.order_id=o.id
  where o.date>=month_start and o.date<month_start+interval '1 month'
   and (c.responsible=auth.uid() or public.prisma_has_permission(auth.uid(),'preparation_kpi'))
 ), checklist_intervals as (
  select a.order_id,a.after_value,a.recorded_at,
   lead(a.recorded_at,1,coalesce(o.ended_at,statement_timestamp())) over(partition by a.order_id order by a.id) as next_at
  from orders o join public.prisma_preparation_audit a on a.order_id=o.id and a.operation='check_item'
 ), waits as (
  select order_id,sum(greatest(0,extract(epoch from next_at-recorded_at))) as seconds
  from checklist_intervals where after_value @? '$.* ? (@ == "unavailable")' group by order_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'wait_seconds',coalesce(w.seconds,0),
  'material_shortage',w.order_id is not null,
  'input_error',exists(select 1 from public.prisma_preparation_audit a where a.order_id=o.id
    and a.operation='correct' and a.reason like 'Error de captura%'),
  'incompatible',exists(select 1 from public.prisma_die_material_events d where d.order_id=o.id and d.decision='warning')
    or exists(select 1 from public.prisma_die_material_events d where d.order_id=o.id and d.decision='rule' and d.reason like 'Incompatible.%')
  )), '[]') into result from orders o left join waits w on w.order_id=o.id;
 return jsonb_build_object('orders',result);
end $$;
revoke all on function public.prisma_preparation_indicator_events(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_preparation_indicator_events(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
