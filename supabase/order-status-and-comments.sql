-- Ejecutar completo después de accounts-and-sessions.sql.
-- Incluye la actualización de tintas y metraje obligatorio; conserva órdenes e inventario.
-- Ejecutar completo después de accounts-and-sessions.sql. Conserva órdenes e inventario.
begin;
create table if not exists public.prisma_order_ink_settings(id integer primary key check(id=1),owner_id uuid references auth.users(id) on delete set null,options jsonb not null default '[]',updated_at timestamptz not null default now());
alter table public.prisma_order_ink_settings enable row level security;
revoke all on public.prisma_order_ink_settings from public,anon,authenticated;
create or replace function public.prisma_order_ink_options(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare options jsonb;item jsonb;p public.prisma_products%rowtype;seen text[]:=array[]::text[];
begin
 perform public.prisma_require_admin();
 if payload->>'operation'='save' then
  options:=payload->'options';if jsonb_typeof(options) is distinct from 'array' or jsonb_array_length(options)>100 then raise exception 'Configura hasta 100 tintas personalizadas.';end if;
  for item in select value from jsonb_array_elements(options) loop
   if coalesce(item->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or item->>'id'=any(seen) or coalesce(btrim(item->>'label'),'')='' or length(item->>'label')>80 or coalesce(item->>'family','') not in ('Base Agua','UV','Film') then raise exception 'Revisa las opciones personalizadas.';end if;
   seen:=array_append(seen,item->>'id');
   if nullif(item->>'product_id','') is not null then
    select * into p from public.prisma_products where id=(item->>'product_id')::bigint and category='tinta';
    if not found or (item->>'family'='UV' and lower(btrim(p.kind))<>'uv') or (item->>'family'='Film' and lower(btrim(p.kind))<>'film') or (item->>'family'='Base Agua' and lower(btrim(p.kind)) not in ('base agua','base de agua','agua')) then raise exception 'La tinta relacionada debe ser del mismo tipo.';end if;
   end if;
  end loop;
  insert into public.prisma_order_ink_settings(id,owner_id,options) values(1,auth.uid(),options) on conflict(id) do update set owner_id=auth.uid(),options=excluded.options,updated_at=now();
 elsif payload->>'operation' is distinct from 'get' then raise exception 'Acción no válida.';end if;
 return jsonb_build_object('options',coalesce((select s.options from public.prisma_order_ink_settings s where id=1),'[]'::jsonb));
end $$;
revoke all on function public.prisma_order_ink_options(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_order_ink_options(jsonb) to authenticated;
do $$begin
 if to_regprocedure('public.prisma_order_portal_ink_internal(text,jsonb)') is null then alter function public.prisma_order_portal(text,jsonb) rename to prisma_order_portal_ink_internal;end if;
end $$;
revoke all on function public.prisma_order_portal_ink_internal(text,jsonb) from public,anon,authenticated;
create or replace function public.prisma_order_portal(access_key text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;options jsonb;item jsonb;custom jsonb;selections jsonb:='[]';b jsonb:=payload->'order';family text;global_family text:=b->>'ink_family';families text[]:=array[]::text[];labels text[]:=array[]::text[];label_value text;summary text;p public.prisma_products%rowtype;entry jsonb;
begin
 -- Always validate the private capture link using the existing restricted function first.
 if payload->>'operation'<>'submit' then
  result:=public.prisma_order_portal_ink_internal(access_key,payload);
  if payload->>'operation'='catalog' then return result||jsonb_build_object('ink_options',coalesce((select s.options from public.prisma_order_ink_settings s where id=1),'[]'::jsonb));end if;
  if payload->>'operation'='list' then
   select coalesce(jsonb_agg(value||jsonb_build_object('ink_family',coalesce((select specifications->>'tipo_tinta' from public.prisma_orders where id=(value->>'id')::bigint),''))),'[]'::jsonb) into selections from jsonb_array_elements(result->'orders');return jsonb_set(result,'{orders}',selections);
  end if;
  return result;
 end if;
 -- A catalog call checks the link before reading configuration or validating submitted products.
 perform public.prisma_order_portal_ink_internal(access_key,jsonb_build_object('operation','catalog'));
 if nullif(b->>'meters','') is null or (b->>'meters')::numeric<=0 or (b->>'meters')::numeric>1e12 then raise exception 'Captura un metraje mayor que cero.';end if;
 if global_family is not null and global_family not in ('Base Agua','UV','Film') then raise exception 'Selecciona Base Agua, UV o Film.';end if;
 options:=coalesce((select s.options from public.prisma_order_ink_settings s where id=1),'[]'::jsonb);
 for item in select value from jsonb_array_elements(coalesce(b->'ink_selections','[]'::jsonb)) loop
  family:=coalesce(item->>'ink_family',global_family);if family is not null and family not in ('Base Agua','UV','Film') then raise exception 'Selecciona Base Agua, UV o Film en cada tinta.';end if;entry:=item;
  if coalesce(item->>'custom_id','')<>'' then
   select value into custom from jsonb_array_elements(options) where value->>'id'=item->>'custom_id' and value->>'family'=family;
   if custom is null then raise exception 'La tinta personalizada cambió. Actualiza el catálogo.';end if;
   entry:=jsonb_build_object('slot',item->'slot','product_id',custom->'product_id','pantone',case when nullif(custom->>'product_id','') is null then custom->>'label'||' ('||family||')' else '' end);
  end if;
  if nullif(entry->>'product_id','') is not null then
   select * into p from public.prisma_products where id=(entry->>'product_id')::bigint and category='tinta';
   if not found or (family='UV' and lower(btrim(p.kind))<>'uv') or (family='Film' and lower(btrim(p.kind))<>'film') or (family='Base Agua' and lower(btrim(p.kind)) not in ('base agua','base de agua','agua')) then raise exception 'La tinta no corresponde al tipo seleccionado.';end if;
  end if;
  if family is not null then
   if item ? 'ink_family' then entry:=entry||jsonb_build_object('ink_family',family);end if;families:=array_append(families,family);
  end if;
  if item ? 'ink_family' and coalesce(item->>'custom_id','')='' and coalesce(btrim(entry->>'pantone'),'')<>'' then entry:=jsonb_set(entry,'{pantone}',to_jsonb((entry->>'pantone')||' ('||family||')'));end if;
  label_value:=case when coalesce(btrim(entry->>'pantone'),'')<>'' then 'Pantone '||(entry->>'pantone') else p.name||' ['||p.code||']'||case when family is null then '' else ' ('||family||')' end end;
  labels:=array_append(labels,label_value);
  selections:=selections||jsonb_build_array(entry);
 end loop;
 result:=public.prisma_order_portal_ink_internal(access_key,jsonb_set(payload,'{order,ink_selections}',selections));
 if cardinality(families)>0 then select array_agg(f order by array_position(array['Base Agua','UV','Film'],f)) into families from (select distinct unnest(families) as f)x;summary:=case when cardinality(families)>1 then 'Mixta ('||array_to_string(families,' + ')||')' else families[1] end;elsif global_family is not null then summary:=global_family;end if;
 if summary is not null then update public.prisma_orders set specifications=specifications||jsonb_build_object('tipo_tinta',summary,'colores',array_to_string(labels,' · ')) where id=(result->>'id')::bigint;end if;
 return result;
end $$;
revoke all on function public.prisma_order_portal(text,jsonb) from public,anon,authenticated;
grant execute on function public.prisma_order_portal(text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
begin;
create table if not exists public.prisma_order_comments(id bigint generated by default as identity primary key,order_id bigint not null references public.prisma_orders(id),body text not null check(length(body) between 1 and 2000),author text not null,user_id uuid references auth.users(id) on delete set null,created_at timestamptz not null default now());
create table if not exists public.prisma_order_status_access(id integer primary key check(id=1),token_hash text not null,enabled boolean not null default true);
create table if not exists public.prisma_order_status_months(month text primary key,report jsonb not null,updated_at timestamptz not null default now());
alter table public.prisma_order_comments enable row level security;
alter table public.prisma_order_status_access enable row level security;
alter table public.prisma_order_status_months enable row level security;
revoke all on public.prisma_order_comments,public.prisma_order_status_access,public.prisma_order_status_months from public,anon,authenticated;
create or replace function public.prisma_order_comments(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare oid bigint:=(payload->>'order_id')::bigint;author_name text;result jsonb;
begin
 perform public.prisma_authorize();if not public.prisma_has_permission(auth.uid(),'production') and not public.prisma_has_permission(auth.uid(),'preparation') then raise exception 'No tienes permiso para comentar órdenes.';end if;
 if not exists(select 1 from public.prisma_orders where id=oid) then raise exception 'Orden no encontrada.';end if;
 if payload->>'operation'='add' then
  if coalesce(btrim(payload->>'body'),'')='' or length(payload->>'body')>2000 then raise exception 'Escribe un comentario de hasta 2000 caracteres.';end if;
  select left(coalesce(nullif(btrim(p.preferences->>'reportName'),''),nullif(btrim(u.raw_user_meta_data->>'full_name'),''),nullif(btrim(u.raw_user_meta_data->>'display_name'),''),'Usuario autorizado'),100) into author_name from auth.users u left join public.prisma_user_preferences p on p.user_id=u.id where u.id=auth.uid();
  insert into public.prisma_order_comments(order_id,body,author,user_id) values(oid,btrim(payload->>'body'),coalesce(author_name,'Usuario autorizado'),auth.uid());
 elsif payload->>'operation' is distinct from 'list' then raise exception 'Acción no válida.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'body',body,'author',author,'created_at',created_at) order by id),'[]'::jsonb) into result from public.prisma_order_comments where order_id=oid;return jsonb_build_object('comments',result);
end $$;
create or replace function public.prisma_refresh_order_status_month(target_month text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare report_value jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'folio',o.folio,'np',o.np,'product',o.product,'client',o.client,'machine',o.machine,'pressman',o.pressman,'scheduled_date',coalesce(o.scheduled_date,o.date),'scheduled_start',o.scheduled_start,'scheduled_end',o.scheduled_end,'started_at',o.started_at,'ended_at',o.ended_at,'meters',o.planned_meters,'queue_number',o.queue_number,'status',case when o.status='cancelled' then 'Cancelada' when o.status='confirmed' then 'Cerrada' when o.ended_at is not null then 'Preparada' when o.started_at is not null then 'En preparación' else 'En espera' end) order by o.queue_number nulls last,o.id),'[]'::jsonb) into report_value from public.prisma_orders o where to_char(coalesce(o.scheduled_date,o.date),'YYYY-MM')=target_month;
 insert into public.prisma_order_status_months(month,report) values(target_month,report_value) on conflict(month) do update set report=excluded.report,updated_at=now();
end $$;
create or replace function public.prisma_archive_order_status() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.prisma_refresh_order_status_month(to_char(coalesce(new.scheduled_date,new.date),'YYYY-MM'));
 if tg_op='UPDATE' and to_char(coalesce(old.scheduled_date,old.date),'YYYY-MM')<>to_char(coalesce(new.scheduled_date,new.date),'YYYY-MM') then perform public.prisma_refresh_order_status_month(to_char(coalesce(old.scheduled_date,old.date),'YYYY-MM'));end if;return new;
end $$;
drop trigger if exists prisma_archive_order_status on public.prisma_orders;
create trigger prisma_archive_order_status after insert or update on public.prisma_orders for each row execute function public.prisma_archive_order_status();
do $$declare m text;begin for m in select distinct to_char(coalesce(scheduled_date,date),'YYYY-MM') from public.prisma_orders loop perform public.prisma_refresh_order_status_month(m);end loop;end $$;
create or replace function public.prisma_manage_order_status(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare secret text;
begin
 perform public.prisma_require_admin();if payload->>'operation'='configure' then secret:='st_'||encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex');insert into public.prisma_order_status_access values(1,encode(sha256(convert_to(secret,'UTF8')),'hex'),true) on conflict(id) do update set token_hash=excluded.token_hash,enabled=true;
 elsif payload->>'operation'='disable' then update public.prisma_order_status_access set enabled=false where id=1;
 elsif payload->>'operation' is distinct from 'status' then raise exception 'Acción no válida.';end if;
 return jsonb_build_object('enabled',coalesce((select enabled from public.prisma_order_status_access where id=1),false),'access_key',secret);
end $$;
create or replace function public.prisma_order_status(access_key text,target_month text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare m text:=coalesce(target_month,to_char(public.prisma_today(),'YYYY-MM'));report_value jsonb;months jsonb;stamp timestamptz;
begin
 if access_key is null or access_key !~ '^st_[a-f0-9]{64}$' or not exists(select 1 from public.prisma_order_status_access where id=1 and enabled and token_hash=encode(sha256(convert_to(access_key,'UTF8')),'hex')) then raise exception 'El enlace de consulta no está autorizado o fue desactivado.';end if;
 if m !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Mes no válido.';end if;
 select report,updated_at into report_value,stamp from public.prisma_order_status_months where month=m;
 select jsonb_agg(month order by month desc) into months from (select month from public.prisma_order_status_months union select to_char(public.prisma_today(),'YYYY-MM') union select m)x;
 return jsonb_build_object('month',m,'months',months,'orders',coalesce(report_value,'[]'::jsonb),'updated_at',coalesce(stamp,now()));
end $$;
revoke all on function public.prisma_order_comments(jsonb),public.prisma_refresh_order_status_month(text),public.prisma_archive_order_status(),public.prisma_manage_order_status(jsonb),public.prisma_order_status(text,text) from public,anon,authenticated;
grant execute on function public.prisma_order_comments(jsonb),public.prisma_manage_order_status(jsonb) to authenticated;
grant execute on function public.prisma_order_status(text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
