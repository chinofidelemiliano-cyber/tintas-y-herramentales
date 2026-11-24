-- Aplicar después de las migraciones de órdenes, previa copia de seguridad de Supabase.
begin;

-- Preserve the existing account screen and grant only the added operations explicitly.
do $$
declare original text; changed text;
begin
 original:=pg_get_functiondef('public.prisma_admin_accounts(jsonb)'::regprocedure);
 if position('preparation_edit' in original)=0 then
  changed:=replace(original,$old$'production_audit']$old$,
   $new$'production_audit','preparation_edit','preparation_correct','die_authorize','preparation_kpi','preparation_handoff']$new$);
  if changed=original then raise exception 'La lista de permisos instalada no coincide con la versión requerida.'; end if;
  execute changed;
 end if;
end $$;

create table if not exists public.prisma_preparation_clocks (
 order_id bigint primary key references public.prisma_orders(id),
 responsible uuid references auth.users(id),
 paused_at timestamptz,
 paused_seconds numeric not null default 0 check (paused_seconds >= 0),
 closed_at timestamptz,
 correction jsonb,
 checklist jsonb not null default '{}',
 handed_off_at timestamptz,
 handed_off_by uuid references auth.users(id),
 version integer not null default 0
);
alter table public.prisma_preparation_clocks add column if not exists checklist jsonb not null default '{}';
alter table public.prisma_preparation_clocks add column if not exists handed_off_at timestamptz;
alter table public.prisma_preparation_clocks add column if not exists handed_off_by uuid references auth.users(id);
create unique index if not exists prisma_one_open_preparation
 on public.prisma_preparation_clocks(responsible) where closed_at is null;

create table if not exists public.prisma_preparation_audit (
 id bigint generated always as identity primary key,
 order_id bigint not null references public.prisma_orders(id),
 actor uuid not null references auth.users(id),
 recorded_at timestamptz not null default clock_timestamp(),
 operation text not null,
 reason text,
 before_value jsonb not null,
 after_value jsonb not null
);

create index if not exists prisma_preparation_audit_order_operation
 on public.prisma_preparation_audit(order_id,operation,recorded_at desc);

create table if not exists public.prisma_preparation_reminders (
 user_id uuid primary key references auth.users(id) on delete cascade,
 first_minutes integer check (first_minutes between 1 and 1440),
 second_minutes integer check (second_minutes between 1 and 1440),
 shift_end time,
 check (first_minutes is null or second_minutes is null or first_minutes<second_minutes)
);
alter table public.prisma_preparation_reminders enable row level security;
revoke all on public.prisma_preparation_reminders from public,anon,authenticated;

alter table public.prisma_preparation_clocks enable row level security;
alter table public.prisma_preparation_audit enable row level security;
revoke all on public.prisma_preparation_clocks,public.prisma_preparation_audit from public,anon,authenticated;

create or replace function public.prisma_preparation_items(target bigint, statuses jsonb) returns jsonb
language sql stable set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('key',item_key,'kind',kind,'label',label,
  'status',coalesce(statuses->>item_key,'pending')) order by position,item_key),'[]'::jsonb)
 from (
  select position,kind,label,md5(kind||':'||label) item_key
  from (
   select v.* from public.prisma_orders o
   cross join lateral (values
     (1,'Suaje',o.specifications->>'suaje'),
     (2,'Placa',o.specifications->>'placas'),
     (3,'Pleca',o.specifications->>'pleca'),
     (4,'Material',coalesce(nullif(o.specifications->'production_plan'->>'material_code',''),o.specifications->'production_plan'->>'material_surface')),
     (6,'Observaciones',o.notes)
   ) v(position,kind,label) where o.id=target
   union
   select 5,'Tinta',case when coalesce(slot->>'pantone','')<>'' then 'Pantone '||(slot->>'pantone') else p.name||' · '||p.code end
   from public.prisma_orders o cross join lateral jsonb_array_elements(o.ink_selections) slot
   left join public.prisma_products p on p.id=(slot->>'product_id')::bigint where o.id=target
   union
   select 5,'Tinta',o.specifications->>'colores' from public.prisma_orders o
   where o.id=target and o.ink_selections='[]'::jsonb and not exists(select 1 from public.prisma_items i where i.order_id=o.id)
   union
   select 5,'Tinta',p.name||' · '||p.code from public.prisma_items i
   join public.prisma_lots l on l.id=i.lot_id join public.prisma_products p on p.id=l.product_id
   where i.order_id=target
  ) entries where nullif(trim(label),'') is not null
 ) keyed;
$$;
revoke all on function public.prisma_preparation_items(bigint,jsonb) from public,anon,authenticated;

create or replace function public.prisma_preparation_order_fields(o public.prisma_orders) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
 select jsonb_build_object('notes',o.notes,'machine',o.machine,
  'ink_selections',o.ink_selections,'colors',o.specifications->>'colores',
  'die_id',o.specifications->>'die_id','crease_id',o.specifications->>'crease_id',
  'material_code',o.specifications->'production_plan'->>'material_code',
  'plates',o.specifications->>'placas',
  'requested_thousands',o.pieces/1000,
  'required_date',o.specifications->'production_plan'->>'required_date',
  'priority',o.specifications->'production_plan'->>'priority',
  'estimated_minutes',o.specifications->'production_plan'->>'estimated_preparation_minutes');
$$;
revoke all on function public.prisma_preparation_order_fields(public.prisma_orders) from public,anon,authenticated;

-- Conserva la validación de Pantone y la generación de la hoja de prensista.
do $$
begin
 if to_regprocedure('public.prisma_order_clock_workflow_internal(jsonb)') is null then
  alter function public.prisma_order_clock(jsonb) rename to prisma_order_clock_workflow_internal;
 end if;
end $$;
revoke all on function public.prisma_order_clock_workflow_internal(jsonb) from public,anon,authenticated;

create or replace function public.prisma_close_preparation_on_cancel() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 update public.prisma_preparation_clocks
 set closed_at=coalesce(new.ended_at,clock_timestamp()),
     paused_seconds=paused_seconds+coalesce(greatest(0,extract(epoch from coalesce(new.ended_at,clock_timestamp())-paused_at)),0),
     paused_at=null,version=version+1
 where order_id=new.id and closed_at is null;
 return new;
end $$;
revoke all on function public.prisma_close_preparation_on_cancel() from public,anon,authenticated;
drop trigger if exists prisma_close_preparation_on_cancel on public.prisma_orders;
create trigger prisma_close_preparation_on_cancel after update of status on public.prisma_orders
 for each row when (new.status='cancelled' and old.status is distinct from new.status)
 execute function public.prisma_close_preparation_on_cancel();

create or replace function public.prisma_order_clock(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 o public.prisma_orders%rowtype;
 c public.prisma_preparation_clocks%rowtype;
 op text:=payload->>'operation';
 actor uuid:=auth.uid();
 stamp timestamptz;
 result jsonb;
 previous jsonb;
begin
 perform public.prisma_require_permission('preparation');
 perform pg_advisory_xact_lock(104202611);
 select * into o from public.prisma_orders where id=(payload->>'id')::bigint for update;
 if not found or o.status='cancelled' then raise exception 'Orden no encontrada o cancelada.'; end if;
 select * into c from public.prisma_preparation_clocks where order_id=o.id for update;
 if c.responsible is distinct from actor and c.responsible is not null then
  perform public.prisma_require_admin();
 end if;
 if op in ('start','finish') then
  if c.order_id is null and o.ended_at is null then
   if exists(select 1 from public.prisma_preparation_clocks where responsible=actor and closed_at is null) then
    raise exception 'Ya tienes una preparación abierta. Abre el cronómetro flotante para gestionarla.';
   end if;
   insert into public.prisma_preparation_clocks(order_id,responsible) values(o.id,actor);
  end if;
  if op='finish' and c.order_id is not null and c.closed_at is null then
   if payload ? 'version' and c.version is distinct from (payload->>'version')::integer then
    raise exception 'La preparación cambió en otro dispositivo. Actualiza la página.';
   end if;
  end if;
  result:=public.prisma_order_clock_workflow_internal(payload);
  stamp:=(result->>'ended_at')::timestamptz;
  if op='finish' then
   update public.prisma_preparation_clocks set
    paused_seconds=paused_seconds+coalesce(greatest(0,extract(epoch from stamp-paused_at)),0),
    paused_at=null,closed_at=stamp,version=version+1
   where order_id=o.id and closed_at is null;
  end if;
  return result;
 end if;
 if op is null or op not in ('pause','resume') then raise exception 'Acción de cronómetro no válida.'; end if;
 if c.order_id is null or c.closed_at is not null then raise exception 'La preparación no está abierta.'; end if;
 if c.version is distinct from (payload->>'version')::integer then
  raise exception 'La preparación cambió en otro dispositivo. Actualiza la página.';
 end if;
 stamp:=clock_timestamp();
 previous:=to_jsonb(c);
 if op='pause' and c.paused_at is null then
  update public.prisma_preparation_clocks set paused_at=stamp,version=version+1 where order_id=o.id returning * into c;
 elsif op='resume' and c.paused_at is not null then
  update public.prisma_preparation_clocks set
   paused_seconds=paused_seconds+greatest(0,extract(epoch from stamp-paused_at)),
   paused_at=null,version=version+1 where order_id=o.id returning * into c;
 end if;
 if to_jsonb(c) is distinct from previous then
  insert into public.prisma_preparation_audit(order_id,actor,operation,before_value,after_value)
  values(o.id,actor,op,previous,to_jsonb(c));
 end if;
 return to_jsonb(c);
end $$;
revoke all on function public.prisma_order_clock(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_order_clock(jsonb) to authenticated;

create or replace function public.prisma_preparation_workflow(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 o public.prisma_orders%rowtype;
 c public.prisma_preparation_clocks%rowtype;
 op text:=payload->>'operation';
 from_at timestamptz;
 until_at timestamptz;
 effective numeric;
 pauses numeric;
 idle numeric;
 reason text:=trim(payload->>'reason');
 previous jsonb;
 corrected jsonb;
 item_key text:=payload->>'key';
 item_status text:=payload->>'status';
 edit jsonb:=payload->'fields';
 delivery date;
 plan jsonb;
 estimate integer;
 first_limit integer;
 second_limit integer;
 shift_limit time;
 reminder_settings jsonb;
 updated_specs jsonb;
 tool public.prisma_products%rowtype;
 tool_key text;
 label_key text;
 tool_value text;
 quantity numeric;
 inks jsonb;
 ink jsonb;
 ink_slot integer;
 ink_labels text[];
 next_slots integer[];
 pantone text;
begin
 perform public.prisma_require_permission('preparation');
 if op='reminders' then
  first_limit:=nullif(payload->>'first_minutes','')::integer;
  second_limit:=nullif(payload->>'second_minutes','')::integer;
  if coalesce(payload->>'shift_end','') !~ '^$|^([01][0-9]|2[0-3]):[0-5][0-9]$' then
   raise exception 'Hora de fin de jornada no válida.';
  end if;
  shift_limit:=nullif(payload->>'shift_end','')::time;
  if first_limit not between 1 and 1440 or second_limit not between 1 and 1440 or first_limit>=second_limit then
   raise exception 'Revisa los umbrales. El segundo debe ser mayor que el primero.';
  end if;
  insert into public.prisma_preparation_reminders(user_id,first_minutes,second_minutes,shift_end)
  values(auth.uid(),first_limit,second_limit,shift_limit)
  on conflict(user_id) do update set first_minutes=excluded.first_minutes,
   second_minutes=excluded.second_minutes,shift_end=excluded.shift_end;
  return jsonb_build_object('saved',true);
 end if;
 if op='list' then
  select to_jsonb(r)-'user_id' into reminder_settings from public.prisma_preparation_reminders r where r.user_id=auth.uid();
  return jsonb_build_object('reminders',coalesce(reminder_settings,'{"first_minutes":30,"second_minutes":60}'::jsonb),'clocks',coalesce((
   select jsonb_agg((to_jsonb(cw)-'checklist')||jsonb_build_object('folio',ord.folio,'started_at',ord.started_at,'items',public.prisma_preparation_items(ord.id,cw.checklist),
    'responsible_name',coalesce(nullif(prefs.preferences->>'reportName',''),nullif(person.raw_user_meta_data->>'display_name',''),person.email),
    'estimated_minutes',ord.specifications->'production_plan'->>'estimated_preparation_minutes',
    'changed_at',(select max(a.recorded_at) from public.prisma_preparation_audit a
                  where a.order_id=ord.id and a.operation='edit_order' and a.recorded_at>=ord.started_at)))
   from public.prisma_preparation_clocks cw join public.prisma_orders ord on ord.id=cw.order_id
   left join public.prisma_user_preferences prefs on prefs.user_id=cw.responsible
   left join auth.users person on person.id=cw.responsible
   where cw.responsible=auth.uid() or public.prisma_has_permission(auth.uid(),'preparation_kpi') or public.prisma_has_permission(auth.uid(),'preparation_correct') or public.prisma_has_permission(auth.uid(),'preparation_handoff')
  ),'[]'::jsonb));
 end if;
 if op='check_item' then
  perform pg_advisory_xact_lock(104202611);
  select * into o from public.prisma_orders where id=(payload->>'id')::bigint for update;
  select * into c from public.prisma_preparation_clocks where order_id=o.id for update;
  if c.order_id is null or c.closed_at is not null then raise exception 'La preparación no está abierta.'; end if;
  if c.responsible is distinct from auth.uid() then perform public.prisma_require_admin(); end if;
  if c.version is distinct from (payload->>'version')::integer then
   raise exception 'La preparación cambió. Abre de nuevo la orden.';
  end if;
  if item_status is null or item_status not in ('pending','ready','unavailable','review')
    or not exists(select 1 from jsonb_array_elements(public.prisma_preparation_items(o.id,c.checklist)) item where item->>'key'=item_key) then
   raise exception 'Elemento o estado no válido.';
  end if;
  previous:=c.checklist;
  update public.prisma_preparation_clocks set checklist=jsonb_set(checklist,array[item_key],to_jsonb(item_status)),version=version+1
   where order_id=o.id returning * into c;
  insert into public.prisma_preparation_audit(order_id,actor,operation,before_value,after_value)
   values(o.id,auth.uid(),op,previous,c.checklist);
  return jsonb_build_object('version',c.version,'items',public.prisma_preparation_items(o.id,c.checklist));
 end if;
 if op='handoff' then
  perform public.prisma_require_permission('preparation_handoff');
  perform pg_advisory_xact_lock(104202611);
  select * into o from public.prisma_orders where id=(payload->>'id')::bigint for update;
  if not found or o.status='cancelled' or o.ended_at is null then raise exception 'La preparación debe estar finalizada.'; end if;
  insert into public.prisma_preparation_clocks(order_id,closed_at) values(o.id,o.ended_at) on conflict(order_id) do nothing;
  update public.prisma_preparation_clocks set handed_off_at=clock_timestamp(),handed_off_by=auth.uid(),version=version+1
   where order_id=o.id and handed_off_at is null returning * into c;
  if found then insert into public.prisma_preparation_audit(order_id,actor,operation,before_value,after_value)
    values(o.id,auth.uid(),op,'{}',jsonb_build_object('handed_off_at',c.handed_off_at)); end if;
  return jsonb_build_object('id',o.id);
 end if;
 if op='history' then
  if not (public.prisma_has_permission(auth.uid(),'preparation_edit') or public.prisma_has_permission(auth.uid(),'preparation_correct')) then
   perform public.prisma_require_admin();
  end if;
  return jsonb_build_object('history',coalesce((
   select jsonb_agg(to_jsonb(a) order by a.id desc)
   from public.prisma_preparation_audit a where a.order_id=(payload->>'id')::bigint
    and (exists(select 1 from public.prisma_admins where user_id=auth.uid())
     or (a.operation='edit_order' and public.prisma_has_permission(auth.uid(),'preparation_edit'))
     or (a.operation='correct' and public.prisma_has_permission(auth.uid(),'preparation_correct')))
  ),'[]'::jsonb));
 end if;
 if op in ('edit_fields','edit_order') then
  perform public.prisma_require_permission('preparation_edit');
  if op='edit_order' then perform pg_advisory_xact_lock(104202611); end if;
  select * into o from public.prisma_orders where id=(payload->>'id')::bigint for update;
  if not found or o.status<>'draft' or o.ended_at is not null then
   raise exception 'La orden debe estar pendiente o en preparación.';
  end if;
  previous:=public.prisma_preparation_order_fields(o);
  if op='edit_fields' then
   return jsonb_build_object('fields',previous,'revision',md5(to_jsonb(o)::text));
  end if;
  if payload->>'revision' is distinct from md5(to_jsonb(o)::text) then
   raise exception 'La orden cambió. Abre de nuevo la edición.';
  end if;
  if coalesce(length(reason),0) not between 1 and 1000 or coalesce(length(edit->>'notes'),1001)>1000
   or coalesce(edit->>'machine','') not in ('Mark Andy','Comco 1','Comco 2','Maquina China')
   or coalesce(edit->>'priority','') not in ('Baja','Normal','Alta','Urgente')
   or coalesce(edit->>'required_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
   raise exception 'Revisa la máquina, la fecha, la prioridad, las observaciones y el motivo.';
  end if;
  if left(edit->>'machine',5)='Comco' and exists(
   select 1 from jsonb_array_elements(coalesce(edit->'ink_selections',o.ink_selections)) slot where (slot->>'slot')::integer>6) then
   raise exception 'La orden usa más posiciones de tinta de las que admite la máquina.';
  end if;
  delivery:=(edit->>'required_date')::date;
  estimate:=nullif(edit->>'estimated_minutes','')::integer;
  if estimate is not null and estimate not between 1 and 1440 then raise exception 'Estimación fuera de rango.'; end if;
  plan:=coalesce(o.specifications->'production_plan','{}'::jsonb)||jsonb_build_object(
   'required_date',delivery,'priority',edit->>'priority','estimated_preparation_minutes',estimate);
  updated_specs:=o.specifications;
  if edit ? 'material_code' then
   if length(trim(coalesce(edit->>'material_code','')))>200 then raise exception 'Código de material demasiado largo.'; end if;
   plan:=plan||jsonb_build_object('material_code',trim(coalesce(edit->>'material_code','')));
  end if;
  if edit ? 'plates' then
   if length(trim(coalesce(edit->>'plates','')))>200 then raise exception 'Dato de placas demasiado largo.'; end if;
   updated_specs:=updated_specs||jsonb_build_object('placas',trim(coalesce(edit->>'plates','')));
  end if;
  for tool_key,label_key in select * from (values ('die_id','suaje'),('crease_id','pleca')) names loop
   if edit ? tool_key then
    tool_value:=nullif(edit->>tool_key,'');
    if tool_value is not null then
     select * into tool from public.prisma_products where id=tool_value::bigint and category='herramental'
      and code like case when tool_key='die_id' then 'SJ%' else 'PD%' end;
     if not found then raise exception 'Selecciona un herramental válido.'; end if;
     updated_specs:=updated_specs||jsonb_build_object(tool_key,tool.id,label_key,tool.code||' · '||tool.name);
    elsif updated_specs ? tool_key then
     updated_specs:=updated_specs-array[tool_key,label_key];
    end if;
    if tool_key='crease_id' then
     plan:=plan||jsonb_build_object('has_crease',case when updated_specs ? tool_key then 'yes' else 'no' end);
    end if;
   end if;
  end loop;
  if plan->>'production_type' in ('cut','print_cut','white') and not (updated_specs ? 'die_id') then
   raise exception 'El proceso requiere un suaje.';
  end if;
  if plan->>'production_type'='print' and (updated_specs ? 'die_id' or updated_specs ? 'crease_id') then
   raise exception 'Solo impresión no admite herramentales de corte.';
  end if;
  if (plan->>'production_type' in ('print','print_cut') or plan->>'white_process'='ink')
   and coalesce(updated_specs->>'placas','')='' then raise exception 'Captura placas o clichés.'; end if;
  if plan->>'production_type'='cut' or plan->>'white_process'='material' then
   if coalesce(updated_specs->>'placas','')<>'' then raise exception 'Este proceso no admite placas.'; end if;
  end if;
  inks:=o.ink_selections;
  if edit ? 'ink_selections' then
   inks:=edit->'ink_selections';
   if jsonb_typeof(inks) is distinct from 'array' or jsonb_array_length(inks)>12 then
    raise exception 'Revisa las posiciones de tinta.';
   end if;
   if plan->>'production_type'='cut' or plan->>'white_process'='material' then
    if jsonb_array_length(inks)>0 then raise exception 'Este proceso no admite tintas.'; end if;
   elsif (plan->>'production_type' in ('print','print_cut') or plan->>'white_process'='ink') and jsonb_array_length(inks)=0 then
    raise exception 'Selecciona las tintas requeridas por la orden.';
   end if;
   if inks is distinct from o.ink_selections then
    if exists(select 1 from public.prisma_items where order_id=o.id) then
     raise exception 'La orden ya tiene pesajes. Revisa la bitácora antes de cambiar sus tintas.';
    end if;
    ink_labels:=array[]::text[];
    next_slots:=array[]::integer[];
    for ink in select value from jsonb_array_elements(inks) loop
     ink_slot:=(ink->>'slot')::integer;
     pantone:=trim(coalesce(ink->>'pantone',''));
     if ink_slot is null or ink_slot not between 1 and (case when left(edit->>'machine',5)='Comco' then 6 else 12 end)
      or ink_slot=any(next_slots) or ((pantone='')=(nullif(ink->>'product_id','') is null))
      or length(pantone)>100
      or coalesce(ink->>'ink_family','') not in ('','Base Agua','UV','Film') then
      raise exception 'Revisa las posiciones de tinta o Pantone.';
     end if;
     next_slots:=array_append(next_slots,ink_slot);
     if pantone<>'' then
      ink_labels:=array_append(ink_labels,'Pantone '||pantone);
     else
      select * into tool from public.prisma_products where id=(ink->>'product_id')::bigint and category='tinta';
      if not found or (ink->>'ink_family'='UV' and lower(trim(tool.kind))<>'uv')
       or (ink->>'ink_family'='Film' and lower(trim(tool.kind))<>'film')
       or (ink->>'ink_family'='Base Agua' and lower(trim(tool.kind)) not in ('base agua','base de agua','agua')) then
        raise exception 'Selecciona una tinta del catálogo y tipo correspondiente.';
      end if;
      ink_labels:=array_append(ink_labels,tool.name||' ['||tool.code||']');
     end if;
    end loop;
    if exists(select 1 from public.prisma_pantone_requests p where p.order_id=o.id and p.status<>'pending'
      and not exists(select 1 from jsonb_array_elements(inks) j where (j->>'slot')::integer=p.slot and j->>'pantone'=p.pantone)) then
     raise exception 'Conserva los Pantones ya preparados y sus movimientos.';
    end if;
    delete from public.prisma_pantone_requests p where p.order_id=o.id and p.status='pending'
     and not exists(select 1 from jsonb_array_elements(inks) j where (j->>'slot')::integer=p.slot and j->>'pantone'=p.pantone);
    insert into public.prisma_pantone_requests(order_id,slot,pantone)
     select o.id,(j->>'slot')::integer,trim(j->>'pantone') from jsonb_array_elements(inks) j
     where nullif(trim(j->>'pantone'),'') is not null on conflict(order_id,slot) do nothing;
    updated_specs:=(updated_specs-'tipo_tinta')||jsonb_build_object('colores',array_to_string(ink_labels,' · '));
   end if;
  end if;
  quantity:=o.pieces;
  if nullif(edit->>'requested_thousands','') is not null then
   if edit->>'requested_thousands' !~ '^[0-9]+([.][0-9]+)?$' then raise exception 'Cantidad no válida.'; end if;
   quantity:=(edit->>'requested_thousands')::numeric*1000;
   if quantity<=0 or quantity>1e12 then raise exception 'Cantidad no válida.'; end if;
   plan:=plan||jsonb_build_object('requested_thousands',quantity/1000);
  end if;
  update public.prisma_orders set notes=edit->>'notes',machine=edit->>'machine',pieces=quantity,ink_selections=inks,
   specifications=jsonb_set(updated_specs,'{production_plan}',plan) where id=o.id returning * into o;
  corrected:=public.prisma_preparation_order_fields(o);
  if previous is distinct from corrected then
   insert into public.prisma_preparation_audit(order_id,actor,operation,reason,before_value,after_value)
   values(o.id,auth.uid(),op,reason,previous,corrected);
  end if;
  return jsonb_build_object('id',o.id);
 end if;
 if op is distinct from 'correct' then raise exception 'Acción no permitida.'; end if;
 perform public.prisma_require_permission('preparation_correct');
 perform pg_advisory_xact_lock(104202611);
 select * into o from public.prisma_orders where id=(payload->>'id')::bigint for update;
 if not found or o.status='cancelled' or o.started_at is null or o.ended_at is null then
  raise exception 'Selecciona una preparación finalizada.';
 end if;
 select * into c from public.prisma_preparation_clocks where order_id=o.id for update;
 if coalesce(c.version,0) is distinct from (payload->>'version')::integer then
  raise exception 'El registro cambió. Abre de nuevo la orden.';
 end if;
 if c.order_id is null then
  insert into public.prisma_preparation_clocks(order_id,responsible,closed_at)
  values(o.id,null,o.ended_at) returning * into c;
 end if;
 from_at:=(payload->>'started_at')::timestamptz;
 until_at:=(payload->>'ended_at')::timestamptz;
 effective:=(payload->>'effective_seconds')::numeric;
 pauses:=(payload->>'paused_seconds')::numeric;
 idle:=(payload->>'idle_seconds')::numeric;
 if from_at is null or until_at is null or not isfinite(from_at) or not isfinite(until_at)
  or until_at<=from_at or until_at>clock_timestamp()
  or effective is null or pauses is null or idle is null
  or effective::text in ('NaN','Infinity','-Infinity')
  or pauses::text in ('NaN','Infinity','-Infinity')
  or idle::text in ('NaN','Infinity','-Infinity') or least(effective,pauses,idle)<0
  or abs(effective+pauses+idle-extract(epoch from until_at-from_at))>=1
  or coalesce(length(reason),0) not between 1 and 1000 then
  raise exception 'Revisa las fechas, el motivo y que la suma de los tiempos coincida con el total.';
 end if;
 previous:=coalesce(c.correction,jsonb_build_object('started_at',o.started_at,'ended_at',o.ended_at,
  'paused_seconds',c.paused_seconds,'effective_seconds',greatest(0,extract(epoch from o.ended_at-o.started_at)-c.paused_seconds),'idle_seconds',0));
 corrected:=jsonb_build_object('started_at',from_at,'ended_at',until_at,'effective_seconds',effective,
  'paused_seconds',pauses,'idle_seconds',idle);
 update public.prisma_preparation_clocks set correction=corrected,version=version+1
 where order_id=o.id returning * into c;
 insert into public.prisma_preparation_audit(order_id,actor,operation,reason,before_value,after_value)
 values(o.id,auth.uid(),'correct',reason,previous,corrected);
 return to_jsonb(c);
end $$;
revoke all on function public.prisma_preparation_workflow(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_preparation_workflow(jsonb) to authenticated;
do $$
begin
 if to_regprocedure('public.prisma_history_record_workflow_internal(bigint,text)') is null then
  alter function public.prisma_history_record(bigint,text) rename to prisma_history_record_workflow_internal;
 end if;
end $$;
revoke all on function public.prisma_history_record_workflow_internal(bigint,text) from public,anon,authenticated;

create or replace function public.prisma_history_record(sheet_id bigint,phase text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 result jsonb;
 o public.prisma_orders%rowtype;
 c public.prisma_preparation_clocks%rowtype;
 metrics jsonb;
 total_seconds numeric;
 effective numeric;
 pauses numeric;
 idle numeric;
begin
 result:=public.prisma_history_record_workflow_internal(sheet_id,phase);
 if result is null or phase<>'preparation' then return result; end if;
 select ord.* into o from public.prisma_press_sheets sheet
 join public.prisma_orders ord on ord.id=sheet.order_id where sheet.id=sheet_id;
 select * into c from public.prisma_preparation_clocks where order_id=o.id;
 if not found then return result; end if;
 total_seconds:=extract(epoch from coalesce((c.correction->>'ended_at')::timestamptz,o.ended_at)
  -coalesce((c.correction->>'started_at')::timestamptz,o.started_at));
 pauses:=coalesce((c.correction->>'paused_seconds')::numeric,c.paused_seconds);
 idle:=coalesce((c.correction->>'idle_seconds')::numeric,0);
 effective:=coalesce((c.correction->>'effective_seconds')::numeric,greatest(0,total_seconds-pauses));
 metrics:=(result->'metrics')||jsonb_build_object('gross_seconds',total_seconds,'net_seconds',effective,
  'paused_seconds',pauses,'dead_seconds',idle);
 return jsonb_set(jsonb_set(result,'{metrics}',metrics),'{sheet,metrics}',metrics);
end $$;
revoke all on function public.prisma_history_record(bigint,text) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
