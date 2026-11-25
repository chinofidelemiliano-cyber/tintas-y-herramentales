begin;

alter table public.prisma_notification_jobs add column if not exists plant_notice jsonb;

-- Enqueue one digest per device, topic and local day. The installed worker delivers the saved jobs.
create or replace function public.prisma_queue_plant_alerts() returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 day_value date:=(clock_timestamp() at time zone 'America/Mexico_City')::date;
 queued integer;
 days integer:=public.prisma_plant_history_days(day_value);
begin
 if not exists(select 1 from public.prisma_notification_config where id=1) then return 0;end if;
 with usage as (
  select product_id,grams/days daily from public.prisma_plant_ink_demand(day_value-(days-1))
 ), lots as (
  select product_id,sum(grams) balance from public.prisma_lots group by product_id
 ), needs_ink as (
  select count(*) total,string_agg(p.code,', ' order by p.code) codes
  from usage u join public.prisma_products p on p.id=u.product_id
  left join lots l on l.product_id=p.id left join public.prisma_ink_planning s on s.product_id=p.id
  where u.daily>0 and s.ordered_at is null and coalesce(l.balance,0)<=u.daily*(coalesce(s.lead_days,7)+coalesce(s.safety_days,3)+1)
 ), needs_tool as (
  select kind,count(*) total,string_agg(code,', ' order by code) codes from (
   select kind,code from public.prisma_tool_services where received_on is null and due_on<=day_value and service in ('maintenance','audit')
   union
   select 'die',j->>'code' from jsonb_array_elements(public.prisma_plant_tools()) j
   where (j->>'regrinds')::int>=5 or (j->>'cycle_meters')::numeric>=50000
  ) tool group by kind
 ), notices as (
  select 'catalog' permission,'stock' route,'Tintas por pedir' title,total,codes from needs_ink where total>0
  union all
  select 'preparation_edit',case when kind='anilox' then 'anilox' else 'herramental' end,
  case when kind='anilox' then 'Anilox por revisar' else 'Suajes por revisar' end,total,codes from needs_tool where total>0
 )
 insert into public.prisma_notification_jobs(device_id,request_key,plant_notice)
 select d.id,md5(d.id::text||':'||n.route||':'||day_value)::uuid,
  jsonb_build_object('title',n.title,'body',left(n.total||' pendientes · '||n.codes,180),'url','/#'||n.route)
 from notices n cross join public.prisma_notification_devices d
 join public.prisma_members m on m.user_id=d.user_id
 where d.enabled and public.prisma_has_permission(d.user_id,'devices') and public.prisma_has_permission(d.user_id,n.permission)
   and public.prisma_has_permission(d.user_id,case when n.route='stock' then 'inventory' else 'production' end)
 on conflict(request_key) do nothing;
 get diagnostics queued=row_count;
 if queued>0 then perform public.prisma_wake_push();end if;
 return queued;
end $$;
revoke all on function public.prisma_queue_plant_alerts() from public,anon,authenticated;

create or replace function public.prisma_notify_fifth_resharpen() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare total integer; queued integer;
begin
 if not exists(select 1 from public.prisma_notification_config where id=1) then return new;end if;
 select count(*)::int+coalesce((select (c.details->>'initial_regrinds')::int from public.prisma_plant_catalog c where c.kind='die' and c.code=new.code),0)
  into total from public.prisma_tool_services s where s.kind='die' and s.service='resharpen' and s.code=new.code and s.received_on is not null;
 if total<>5 then return new;end if;
 insert into public.prisma_notification_jobs(device_id,request_key,plant_notice)
 select d.id,md5(d.id::text||':fifth-resharpen:'||new.id)::uuid,
  jsonb_build_object('title','Pide un suaje de reemplazo','body',new.code||' completó su quinto reafile.','url','/#herramental')
 from public.prisma_notification_devices d join public.prisma_members m on m.user_id=d.user_id
 where d.enabled and public.prisma_has_permission(d.user_id,'devices') and public.prisma_has_permission(d.user_id,'production') and public.prisma_has_permission(d.user_id,'preparation_edit')
 on conflict(request_key) do nothing;
 get diagnostics queued=row_count;
 if queued>0 then perform public.prisma_wake_push();end if;
 return new;
end $$;
revoke all on function public.prisma_notify_fifth_resharpen() from public,anon,authenticated;
do $$
begin
 if not exists(select 1 from pg_trigger where tgname='prisma_notify_fifth_resharpen' and tgrelid='public.prisma_tool_services'::regclass) then
  create trigger prisma_notify_fifth_resharpen after update of received_on on public.prisma_tool_services
   for each row when (new.service='resharpen' and old.received_on is null and new.received_on is not null)
   execute function public.prisma_notify_fifth_resharpen();
 end if;
end $$;

do $$
begin
 if to_regprocedure('public.prisma_claim_push_without_plant()') is null then
  alter function public.prisma_claim_push_jobs() rename to prisma_claim_push_without_plant;
 end if;
end $$;
revoke all on function public.prisma_claim_push_without_plant() from public,anon,authenticated,service_role;
create or replace function public.prisma_claim_push_jobs() returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 with claimed as materialized (select public.prisma_claim_push_without_plant() jobs)
 select coalesce(jsonb_agg(case when j.plant_notice is not null then jsonb_set(entry,'{payload}',(entry->'payload')||j.plant_notice)
  when r.template is not null then jsonb_set(entry,'{payload,body}',to_jsonb(left((entry->'payload'->>'body')||' · Receta por NP disponible',180)))
  else entry end),'[]')
 from claimed cross join lateral jsonb_array_elements(claimed.jobs) entry
 join public.prisma_notification_jobs j on j.id=(entry->>'id')::bigint
 left join public.prisma_order_plant_recipes r on r.order_id=j.order_id;
$$;
revoke all on function public.prisma_claim_push_jobs() from public,anon,authenticated;
grant execute on function public.prisma_claim_push_jobs() to service_role;

do $$
begin
 perform cron.schedule('prisma-plant-alerts','0 14 * * *','select public.prisma_queue_plant_alerts()');
end $$;
notify pgrst,'reload schema';
commit;
