begin;
create table if not exists public.prisma_die_material_rules (
 die_id bigint not null references public.prisma_products(id),
 material_code text not null check (length(material_code) between 1 and 200),
 compatible boolean not null,
 technical_basis text not null check (length(technical_basis) between 1 and 1000),
 reviewer uuid not null references auth.users(id),
 reviewed_at timestamptz not null default now(),
 primary key(die_id,material_code)
);
create table if not exists public.prisma_die_material_events (
 id bigint generated always as identity primary key,
 order_id bigint not null references public.prisma_orders(id),
 die_id bigint not null references public.prisma_products(id),
 material_code text not null,
 decision text not null check (decision in ('warning','unverified','review','resharpen','authorized','rule')),
 actor uuid references auth.users(id),
 reason text,
 recorded_at timestamptz not null default now()
);
create index if not exists prisma_die_material_events_order on public.prisma_die_material_events(order_id,id desc);
alter table public.prisma_die_material_rules enable row level security;
alter table public.prisma_die_material_events enable row level security;
revoke all on public.prisma_die_material_rules,public.prisma_die_material_events from public,anon,authenticated;

create or replace function public.prisma_die_material_assessment(target bigint,material text) returns text
language sql stable set search_path=public,pg_temp as $$
 select coalesce((select case when compatible then 'compatible' else 'incompatible' end
 from public.prisma_die_material_rules where die_id=target and material_code=upper(trim(material))), 'unverified');
$$;
revoke all on function public.prisma_die_material_assessment(bigint,text) from public,anon,authenticated;

-- Captured orders are checked after their material planning has been written.
create or replace function public.prisma_die_material_order_change() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 die bigint:=nullif(new.specifications->>'die_id','')::bigint;
 material text:=upper(trim(coalesce(new.specifications->'production_plan'->>'material_code','')));
 assessment text;
begin
 if die is null or material='' then return new; end if;
 assessment:=public.prisma_die_material_assessment(die,material);
 if ((old.started_at is null and new.started_at is not null) or (old.ended_at is null and new.ended_at is not null and new.status<>'cancelled')) and assessment='incompatible'
  and not exists(select 1 from public.prisma_die_material_events e
   join public.prisma_die_material_rules r on r.die_id=e.die_id and r.material_code=e.material_code
   where e.order_id=new.id and e.die_id=die and e.material_code=material
    and e.decision='authorized' and e.recorded_at>=r.reviewed_at
    and e.id>coalesce((select max(w.id) from public.prisma_die_material_events w
      where w.order_id=new.id and w.decision in ('warning','unverified')),0)) then
  raise exception 'SUAJE NO COMPATIBLE CON EL MATERIAL. Solicita autorización técnica para continuar.';
 end if;
 if assessment<>'compatible' and (old.specifications->>'die_id' is distinct from new.specifications->>'die_id'
  or old.specifications->'production_plan'->>'material_code' is distinct from new.specifications->'production_plan'->>'material_code')
 then
  insert into public.prisma_die_material_events(order_id,die_id,material_code,decision,actor)
  values(new.id,die,material,case when assessment='incompatible' then 'warning' else 'unverified' end,auth.uid());
 end if;
 return new;
end $$;
revoke all on function public.prisma_die_material_order_change() from public,anon,authenticated;
drop trigger if exists prisma_die_material_order_change on public.prisma_orders;
create trigger prisma_die_material_order_change after update of specifications,started_at,ended_at on public.prisma_orders
 for each row execute function public.prisma_die_material_order_change();

create or replace function public.prisma_die_material(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 o public.prisma_orders%rowtype;
 die bigint;
 material text;
 op text:=payload->>'operation';
 reason text:=trim(coalesce(payload->>'reason',''));
 assessment text;
 alternatives jsonb;
 events jsonb;
begin
 perform public.prisma_require_permission('preparation');
 if op is distinct from 'get' then perform pg_advisory_xact_lock(104202611); end if;
 select * into o from public.prisma_orders where id=(payload->>'id')::bigint;
 if not found then raise exception 'Orden no encontrada.'; end if;
 die:=nullif(o.specifications->>'die_id','')::bigint;
 material:=upper(trim(coalesce(o.specifications->'production_plan'->>'material_code','')));
 if die is null or material='' then return jsonb_build_object('status','unverified','applicable',false); end if;
 assessment:=public.prisma_die_material_assessment(die,material);
 if op in ('review','resharpen','authorized','rule') then
  if o.status='cancelled' or o.ended_at is not null then raise exception 'La orden ya está cerrada.'; end if;
  if length(reason) not between 1 and 1000 then raise exception 'Registra el motivo o fundamento técnico.'; end if;
  if op='rule' then perform public.prisma_require_admin(); end if;
  if op='authorized' then perform public.prisma_require_permission('die_authorize'); end if;
  if op='rule' then
   if jsonb_typeof(payload->'compatible') is distinct from 'boolean' then raise exception 'Selecciona el resultado técnico.'; end if;
   insert into public.prisma_die_material_rules(die_id,material_code,compatible,technical_basis,reviewer)
   values(die,material,(payload->>'compatible')::boolean,reason,auth.uid())
   on conflict(die_id,material_code) do update set compatible=excluded.compatible,technical_basis=excluded.technical_basis,
    reviewer=excluded.reviewer,reviewed_at=clock_timestamp();
   reason:=case when (payload->>'compatible')::boolean then 'Compatible. ' else 'Incompatible. ' end||reason;
   assessment:=public.prisma_die_material_assessment(die,material);
  elsif op='authorized' and assessment<>'incompatible' then
   raise exception 'Esta autorización aplica únicamente a una incompatibilidad registrada.';
  end if;
  insert into public.prisma_die_material_events(order_id,die_id,material_code,decision,actor,reason)
  values(o.id,die,material,op,auth.uid(),reason);
 elsif op is distinct from 'get' then raise exception 'Acción no válida.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'name',p.name) order by p.code),'[]') into alternatives
 from public.prisma_die_material_rules r join public.prisma_products p on p.id=r.die_id
 where r.compatible and r.material_code=material;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]') into events
 from public.prisma_die_material_events e where e.order_id=o.id;
 return jsonb_build_object('status',assessment,'applicable',true,'material_code',material,
  'alternatives',alternatives,'events',events);
end $$;
revoke all on function public.prisma_die_material(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_die_material(jsonb) to authenticated;

do $$
begin
 if to_regprocedure('public.prisma_order_portal_die_material_internal(text,jsonb)') is null then
  alter function public.prisma_order_portal(text,jsonb) rename to prisma_order_portal_die_material_internal;
 end if;
end $$;
revoke all on function public.prisma_order_portal_die_material_internal(text,jsonb) from public,anon,authenticated;

create or replace function public.prisma_order_portal(access_key text,payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; assessment text;
begin
 result:=public.prisma_order_portal_die_material_internal(access_key,payload);
 if payload->>'operation'='submit' then
  select public.prisma_die_material_assessment((o.specifications->>'die_id')::bigint,o.specifications->'production_plan'->>'material_code')
   into assessment from public.prisma_orders o
   where o.id=(result->>'id')::bigint and o.specifications ? 'die_id';
  if assessment is not null then result:=result||jsonb_build_object('die_compatibility',assessment); end if;
 end if;
 return result;
end $$;
revoke all on function public.prisma_order_portal(text,jsonb) from public,anon,authenticated;
grant execute on function public.prisma_order_portal(text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
