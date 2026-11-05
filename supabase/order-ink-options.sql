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
   if coalesce(item->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or item->>'id'=any(seen) or coalesce(btrim(item->>'label'),'')='' or length(item->>'label')>80 or coalesce(item->>'family','') not in ('Base Agua','UV') then raise exception 'Revisa las opciones personalizadas.';end if;
   seen:=array_append(seen,item->>'id');
   if nullif(item->>'product_id','') is not null then
    select * into p from public.prisma_products where id=(item->>'product_id')::bigint and category='tinta';
    if not found or (item->>'family'='UV' and lower(btrim(p.kind))<>'uv') or (item->>'family'='Base Agua' and lower(btrim(p.kind)) not in ('base agua','base de agua','agua')) then raise exception 'La tinta relacionada debe ser del mismo tipo.';end if;
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
 if global_family is not null and global_family not in ('Base Agua','UV') then raise exception 'Selecciona Base Agua o UV.';end if;
 options:=coalesce((select s.options from public.prisma_order_ink_settings s where id=1),'[]'::jsonb);
 for item in select value from jsonb_array_elements(coalesce(b->'ink_selections','[]'::jsonb)) loop
  family:=coalesce(item->>'ink_family',global_family);if family is not null and family not in ('Base Agua','UV') then raise exception 'Selecciona Base Agua o UV en cada tinta.';end if;entry:=item;
  if coalesce(item->>'custom_id','')<>'' then
   select value into custom from jsonb_array_elements(options) where value->>'id'=item->>'custom_id' and value->>'family'=family;
   if custom is null then raise exception 'La tinta personalizada cambió. Actualiza el catálogo.';end if;
   entry:=jsonb_build_object('slot',item->'slot','product_id',custom->'product_id','pantone',case when nullif(custom->>'product_id','') is null then custom->>'label'||' ('||family||')' else '' end);
  end if;
  if nullif(entry->>'product_id','') is not null then
   select * into p from public.prisma_products where id=(entry->>'product_id')::bigint and category='tinta';
   if not found or (family='UV' and lower(btrim(p.kind))<>'uv') or (family='Base Agua' and lower(btrim(p.kind)) not in ('base agua','base de agua','agua')) then raise exception 'La tinta no corresponde al tipo seleccionado.';end if;
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
 if cardinality(families)>0 then summary:=case when 'Base Agua'=any(families) and 'UV'=any(families) then 'Mixta (Base Agua + UV)' else families[1] end;elsif global_family is not null then summary:=global_family;end if;
 if summary is not null then update public.prisma_orders set specifications=specifications||jsonb_build_object('tipo_tinta',summary,'colores',array_to_string(labels,' · ')) where id=(result->>'id')::bigint;end if;
 return result;
end $$;
revoke all on function public.prisma_order_portal(text,jsonb) from public,anon,authenticated;
grant execute on function public.prisma_order_portal(text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
