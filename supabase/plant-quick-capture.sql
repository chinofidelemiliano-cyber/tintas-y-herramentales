begin;

create or replace function public.prisma_forecast_parts() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.prisma_require_permission('inventory');
 return jsonb_build_object('parts',coalesce((
  select jsonb_agg(jsonb_build_object('code',c.code,'names',c.details->'names') order by c.code)
  from public.prisma_plant_catalog c where c.kind='part'
 ),'[]'));
end $$;
revoke all on function public.prisma_forecast_parts() from public,anon,authenticated;
grant execute on function public.prisma_forecast_parts() to authenticated;

create or replace function public.prisma_owner_quick_capture(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 op text:=payload->>'operation';
 np_value text:=upper(trim(coalesce(payload->>'np','')));
 folio_value text:=trim(coalesce(payload->>'folio',''));
 colors text:=trim(coalesce(payload->>'colors',''));
 product_name text:=trim(coalesce(payload->>'product',''));
 hour_value text:=payload->>'scheduled_start';
 meters numeric;
 due date:=public.prisma_today();
 part jsonb;
 tool public.prisma_products%rowtype;
 specs jsonb;
 order_id bigint;
 recipe_key text;
 template jsonb;
begin
 perform public.prisma_require_admin();
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null
  and lower(email)='chinofidelemiliano@gmail.com') then
   raise exception 'Esta captura está reservada para la cuenta propietaria.';
 end if;
 if op='catalog' then
  return jsonb_build_object('today',due,
   'parts',coalesce((select jsonb_agg(jsonb_build_object('code',c.code,'names',c.details->'names') order by c.code)
     from public.prisma_plant_catalog c where c.kind='part'),'[]'),
   'tools',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'name',p.name) order by p.code)
     from public.prisma_products p where p.category='herramental' and p.code like 'SJ%'),'[]'));
 end if;
 if op is distinct from 'submit' then raise exception 'Acción no válida.';end if;
 if coalesce(hour_value,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or length(folio_value) not between 1 and 100
  or length(colors)>1000 or coalesce(payload->>'meters','') !~ '^[0-9]{1,8}([.][0-9]{1,3})?$' then
  raise exception 'Revisa la orden, el metraje y la hora de entrada.';
 end if;
 meters:=(payload->>'meters')::numeric;
 if meters<=0 or meters>15000000 then raise exception 'Captura un metraje válido.';end if;
 select c.details->'names' into part from public.prisma_plant_catalog c where c.kind='part' and c.code=np_value;
 if not found then raise exception 'Selecciona un NP del catálogo.';end if;
 if not exists(select 1 from jsonb_array_elements_text(part) p(name) where p.name=product_name) then
  raise exception 'Selecciona el producto que corresponde al NP.';
 end if;
 if nullif(payload->>'die_id','') is not null then
  select * into tool from public.prisma_products p where p.id=(payload->>'die_id')::bigint and p.category='herramental' and p.code like 'SJ%';
  if not found then raise exception 'Selecciona un suaje del catálogo.';end if;
 end if;
 if colors='' and tool.id is null then raise exception 'Indica al menos los colores o el suaje.';end if;
 perform pg_advisory_xact_lock(104202611);
 if exists(select 1 from public.prisma_orders o where upper(trim(o.folio))=upper(folio_value)
  and upper(trim(o.np))=np_value and coalesce(o.scheduled_date,o.date)=due and o.status<>'cancelled') then
  raise exception 'Ya existe una orden con ese número y NP para hoy.';
 end if;
 specs:=jsonb_build_object('colores',colors,'production_plan',jsonb_build_object('production_type',
  case when colors='' then 'cut' when tool.id is null then 'print' else 'print_cut' end));
 if tool.id is not null then specs:=specs||jsonb_build_object('die_id',tool.id,'suaje',tool.code||' · '||tool.name);end if;
 insert into public.prisma_orders(folio,np,product,client,date,status,source,received_at,scheduled_date,scheduled_start,planned_meters,specifications)
 values(folio_value,np_value,product_name,'',due,'draft','owner_quick',now(),due,hour_value,meters,specs) returning id into order_id;
 recipe_key:=public.prisma_plant_recipe_key(np_value,product_name);
 select c.details into template from public.prisma_plant_catalog c where c.kind='recipe' and c.code=recipe_key;
 if recipe_key is not null then
  insert into public.prisma_order_plant_recipes(order_id,recipe_key,template) values(order_id,recipe_key,template);
 end if;
 return jsonb_build_object('id',order_id,'folio',folio_value,'today',due);
end $$;
revoke all on function public.prisma_owner_quick_capture(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_owner_quick_capture(jsonb) to authenticated;

create table if not exists public.prisma_production_semesters(
 starts_on date primary key,
 ends_before date not null,
 records jsonb not null,
 saved_at timestamptz not null default now(),
 saved_by uuid not null references auth.users(id)
);
alter table public.prisma_production_semesters enable row level security;
revoke all on public.prisma_production_semesters from public,anon,authenticated;
create or replace function public.prisma_production_semester(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 op text:=payload->>'operation';
 yr integer;
 half integer;
 first_day date;
 end_day date;
 history jsonb;
 snapshot public.prisma_production_semesters%rowtype;
begin
 perform public.prisma_require_permission('production_audit');
 if coalesce(payload->>'year','') !~ '^[0-9]{4}$' or coalesce(payload->>'semester','') not in ('1','2') then raise exception 'Selecciona año y semestre.';end if;
 yr:=(payload->>'year')::int;
 half:=(payload->>'semester')::int;
 if yr not between 2000 and 2100 then raise exception 'Año fuera de rango.';end if;
 first_day:=make_date(yr,case when half=1 then 1 else 7 end,1);
 end_day:=(first_day+interval '6 months')::date;
 if op='close' then
  perform public.prisma_require_admin();
  if end_day>public.prisma_today() then raise exception 'El semestre todavía está en curso.';end if;
 elsif op is distinct from 'get' then raise exception 'Acción no válida.';end if;
 select * into snapshot from public.prisma_production_semesters s where s.starts_on=first_day;
 if not found then
  select coalesce(jsonb_agg(j||jsonb_build_object('report_date',report_date) order by report_date,j->>'folio'),'[]') into history
  from jsonb_array_elements(public.prisma_work_history('{"operation":"list"}')->'records') j
  cross join lateral (select coalesce(((j->>'completed_at')::timestamptz at time zone 'America/Mexico_City')::date,
    (j->>'completed_date')::date) report_date) dates
  where j->>'stage'='production' and report_date>=first_day and report_date<end_day;
  if op='close' then
   if jsonb_array_length(history)=0 then raise exception 'No hay registros de producción en el semestre.';end if;
   insert into public.prisma_production_semesters(starts_on,ends_before,records,saved_by) values(first_day,end_day,history,auth.uid())
    on conflict(starts_on) do nothing;
   select * into snapshot from public.prisma_production_semesters s where s.starts_on=first_day;
  end if;
 end if;
 return jsonb_build_object('starts_on',first_day,'ends_on',end_day-1,'records',coalesce(snapshot.records,history,'[]'),
  'closed',snapshot.saved_at is not null,'saved_at',snapshot.saved_at,'can_close',end_day<=public.prisma_today());
end $$;
revoke all on function public.prisma_production_semester(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_production_semester(jsonb) to authenticated;
create or replace function public.prisma_record_resharpen(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare target text:=upper(trim(coalesce(payload->>'code',''))); received date; note text:=trim(coalesce(payload->>'notes','')); snapshot jsonb; service_id bigint;
begin
 perform public.prisma_require_permission('production');
 perform public.prisma_require_permission('preparation_edit');
 received:=(payload->>'received_on')::date;
 if received is null or received>public.prisma_today() or length(note)>1000 then raise exception 'Revisa la fecha y las observaciones.';end if;
 perform pg_advisory_xact_lock(104202611);
 select item into snapshot from jsonb_array_elements(public.prisma_plant_tools()) item where item->>'code'=target;
 if snapshot is null then raise exception 'Suaje no encontrado.';end if;
 if exists(select 1 from public.prisma_tool_services where kind='die' and code=target and service='resharpen' and received_on=received) then
  raise exception 'Ya hay un reafile registrado para ese suaje en esa fecha.';
 end if;
 if (snapshot->>'regrinds')::int>=6 then raise exception 'El suaje ya llegó a seis reafilados.';end if;
 if exists(select 1 from public.prisma_tool_services where kind='die' and code=target and service='resharpen' and received_on is null) then
  raise exception 'Hay una salida pendiente. Registra la recepción desde el historial.';
 end if;
 insert into public.prisma_tool_services(kind,code,service,due_on,snapshot,actor)
 values('die',target,'resharpen',received,snapshot,auth.uid()) returning id into service_id;
 update public.prisma_tool_services set received_on=received,receipt=jsonb_build_object('notes',note) where id=service_id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.prisma_record_resharpen(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_record_resharpen(jsonb) to authenticated;

create table if not exists public.prisma_anilox_cleanings(
 code text not null, cleaned_on date not null, notes text,
 recorded_by uuid not null references auth.users(id), recorded_at timestamptz not null default now(),
 primary key(code,cleaned_on)
);
alter table public.prisma_anilox_cleanings enable row level security;
revoke all on public.prisma_anilox_cleanings from public,anon,authenticated;
create or replace function public.prisma_anilox_cleaning(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare target text:=upper(trim(coalesce(payload->>'code',''))); cleaned date; note text:=trim(coalesce(payload->>'notes',''));
begin
 perform public.prisma_require_permission('production');
 if payload->>'operation'='list' then
  return jsonb_build_object('cleanings',coalesce((select jsonb_agg(jsonb_build_object(
   'code',c.code,'last',c.last_day,'next',(c.last_day+interval '6 months')::date))
   from (select code,max(cleaned_on) last_day from public.prisma_anilox_cleanings group by code)c),'[]'));
 end if;
 if payload->>'operation' is distinct from 'save' then raise exception 'Acción no válida.';end if;
 perform public.prisma_require_permission('preparation_edit');
 if not exists(select 1 from public.prisma_plant_catalog c where c.kind='anilox' and c.code=target) then raise exception 'Anilox no encontrado.';end if;
 cleaned:=(payload->>'cleaned_on')::date;
 if cleaned is null or cleaned>public.prisma_today() or length(note)>1000 then raise exception 'Revisa la fecha de limpieza y las observaciones.';end if;
 insert into public.prisma_anilox_cleanings(code,cleaned_on,notes,recorded_by) values(target,cleaned,note,auth.uid())
  on conflict(code,cleaned_on) do nothing;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.prisma_anilox_cleaning(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_anilox_cleaning(jsonb) to authenticated;

-- Reuse the existing daily anilox digest.
do $$
declare original text; updated text;
begin
 original:=pg_get_functiondef('public.prisma_queue_plant_alerts()'::regprocedure);
 if position('prisma_anilox_cleanings' in original)=0 then
  updated:=replace(original,$old$select 'die',j->>'code' from jsonb_array_elements(public.prisma_plant_tools()) j$old$,
   $new$select 'anilox',ac.code from public.prisma_anilox_cleanings ac group by ac.code
    having (max(ac.cleaned_on)+interval '6 months')::date<=day_value
   union
   select 'die',j->>'code' from jsonb_array_elements(public.prisma_plant_tools()) j$new$);
  if original=updated then raise exception 'La función de avisos instalada no coincide con la versión requerida.';end if;
  execute updated;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
