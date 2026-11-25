begin;

create or replace function public.prisma_capture_pantone(product_id bigint)
returns table(label text, family text, internal boolean)
language sql stable set search_path=public,pg_temp as $$
 with ink as (
  select p.*,r.pantone,r.family,substring(upper(p.name) from '\((BASE AGUA|UV|FILM)\)$') name_family
  from public.prisma_products p
  left join lateral (
   select req.pantone,(select j->>'ink_family' from jsonb_array_elements(o.ink_selections) j where (j->>'slot')::int=req.slot limit 1) family
   from public.prisma_lots l join public.prisma_pantone_requests req on req.output_lot_id=l.id
   join public.prisma_orders o on o.id=req.order_id
   where l.product_id=p.id order by req.id desc limit 1
  ) r on true
  where p.id=$1 and p.category='tinta'
 ), match_code as (
  select ink.*,regexp_match(trim(regexp_replace(upper(coalesce(pantone,name)),'\s*\((BASE AGUA|UV|FILM)\)\s*$','')),
   '^(PANTONE\s+)*(RED\s+|ROJO\s+)?P?([0-9]{2,5})[ -]?([CU])?$') tokens
  from ink
 )
 select case when code like 'MIX-PANTONE-%' then 'P'||tokens[3]||case when tokens[4] is null then '' else '-'||tokens[4] end
  when code like 'P%' then code end,
  coalesce(family,case coalesce(name_family,upper(trim(kind))) when 'UV' then 'UV' when 'FILM' then 'Film'
    when 'BASE AGUA' then 'Base Agua' when 'BASE DE AGUA' then 'Base Agua' when 'AGUA' then 'Base Agua' end),
  code like 'MIX-PANTONE-%'
 from match_code;
$$;
revoke all on function public.prisma_capture_pantone(bigint) from public,anon,authenticated;

-- Keep the catalog product ID as the selection so existing stock and lot flows still apply.
do $$
declare original text; updated text;
begin
 original:=pg_get_functiondef('public.prisma_order_portal_time_internal(text,jsonb)'::regprocedure);
 if position('public.prisma_capture_pantone' in original)=0 then
  updated:=replace(original,$old$if not found or (family='UV' and lower(btrim(p.kind))<>'uv') or (family='Film' and lower(btrim(p.kind))<>'film') or (family='Base Agua' and lower(btrim(p.kind)) not in ('base agua','base de agua','agua')) then$old$,
   $new$if not found or (not exists(select 1 from public.prisma_capture_pantone(p.id) pt(label,recorded_family,internal)
    where pt.internal and pt.label is not null and (pt.recorded_family is null or pt.recorded_family=family)) and
    ((family='UV' and lower(btrim(p.kind))<>'uv') or (family='Film' and lower(btrim(p.kind))<>'film') or (family='Base Agua' and lower(btrim(p.kind)) not in ('base agua','base de agua','agua')))) then$new$);
  updated:=replace(updated,$old$else p.name||' ['||p.code||']'||case$old$,
   $new$else coalesce((select pt.label from public.prisma_capture_pantone(p.id) pt where pt.internal),p.name||' ['||p.code||']')||case$new$);
  if updated=original then raise exception 'La validación de tintas instalada no coincide con la versión requerida.';end if;
  execute updated;
 end if;

 original:=pg_get_functiondef('public.prisma_plant_controls(jsonb)'::regprocedure);
 if position('p.code not like ''MIX-PANTONE-%''' in original)=0 then
  updated:=replace(original,$old$left join public.prisma_ink_planning s on s.product_id=p.id where p.category='tinta'$old$,
   $new$left join public.prisma_ink_planning s on s.product_id=p.id where p.category='tinta' and p.code not like 'MIX-PANTONE-%'$new$);
  if updated=original then raise exception 'La clasificación de tintas instalada no coincide con la versión requerida.';end if;
  execute updated;
 end if;

 original:=pg_get_functiondef('public.prisma_plant_ink_demand(date)'::regprocedure);
 if position('MIX-PANTONE-' in original)=0 then
  updated:=replace(original,$old$) entries group by entries.product_id$old$,
   $new$) entries join public.prisma_products ink on ink.id=entries.product_id
   where ink.code not like 'MIX-PANTONE-%' group by entries.product_id$new$);
  if updated=original then raise exception 'La demanda de tintas instalada no coincide con la versión requerida.';end if;
  execute updated;
 end if;
end $$;

do $$
begin
 if to_regprocedure('public.prisma_capture_pantone_portal_internal(text,jsonb)') is null then
  alter function public.prisma_order_portal(text,jsonb) rename to prisma_capture_pantone_portal_internal;
 end if;
end $$;
revoke all on function public.prisma_capture_pantone_portal_internal(text,jsonb) from public,anon,authenticated;
create or replace function public.prisma_order_portal(access_key text,payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 result:=public.prisma_capture_pantone_portal_internal(access_key,payload);
 if payload->>'operation'='catalog' then
  result:=jsonb_set(result,'{products}',coalesce((
   select jsonb_agg(j||jsonb_build_object('pantone_label',pt.label,'pantone_family',pt.family,'internal_pantone',pt.internal) order by seq)
   from jsonb_array_elements(result->'products') with ordinality items(j,seq)
   left join lateral public.prisma_capture_pantone((j->>'id')::bigint) pt on true
   where not coalesce(pt.internal,false) or pt.label is not null
  ),'[]'));
 end if;
 return result;
end $$;
revoke all on function public.prisma_order_portal(text,jsonb) from public,anon,authenticated;
grant execute on function public.prisma_order_portal(text,jsonb) to anon,authenticated;

create or replace function public.prisma_recipe_reference(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; reference public.prisma_orders%rowtype; code_value text; key_value text; field_values jsonb; plan jsonb; observed jsonb; colors jsonb; catalog_name text; historical_colors text; die_data jsonb;
begin
 result:=public.prisma_plant_controls(payload||jsonb_build_object('operation','recipe'));
 code_value:=result->>'code';
 key_value:=public.prisma_plant_recipe_key(code_value,result->>'product');
 select string into catalog_name from public.prisma_plant_catalog c
 cross join lateral jsonb_array_elements_text(c.details->'names') string
 where c.kind='part' and c.code=code_value and jsonb_array_length(c.details->'names')=1 limit 1;
 select o.* into reference from public.prisma_orders o
 where o.status<>'cancelled' and ((payload ? 'order_id' and o.id=(payload->>'order_id')::bigint)
  or (not (payload ? 'order_id') and upper(trim(o.np)) in (code_value,case when code_value~'^NP[0-9]{3}-[0-9]+$' then substring(code_value from 3) end)
   and public.prisma_plant_recipe_key(o.np,o.product)=key_value))
 order by (o.status='confirmed') desc,(o.ended_at is not null) desc,o.date desc,o.id desc limit 1;
 if not found then return result||jsonb_build_object('reference',jsonb_build_object('product',catalog_name));end if;
 select fields into field_values from public.prisma_press_sheets where order_id=reference.id;
 plan:=reference.specifications->'production_plan';
 select tooling_details into die_data from public.prisma_products p where p.id=nullif(reference.specifications->>'die_id','')::bigint;
 select string_agg(distinct coalesce(pt.label,p.name),', ' order by coalesce(pt.label,p.name)) into historical_colors
 from public.prisma_items i join public.prisma_lots l on l.id=i.lot_id join public.prisma_products p on p.id=l.product_id
 left join lateral public.prisma_capture_pantone(p.id) pt on true where i.order_id=reference.id;
 select coalesce(jsonb_agg(j||jsonb_build_object('name',coalesce(pt.label,p.name),'kind',coalesce(pt.family,p.kind)) order by (j->>'slot')::int),'[]')
  into colors from jsonb_array_elements(reference.ink_selections) j
  left join public.prisma_products p on p.id=nullif(j->>'product_id','')::bigint
  left join lateral public.prisma_capture_pantone(p.id) pt on true;
 observed:=jsonb_strip_nulls(jsonb_build_object('folio',reference.folio,'product',coalesce(nullif(reference.product,''),catalog_name),
  'machine',nullif(reference.machine,''),'pressman',coalesce(nullif(reference.pressman,''),nullif(field_values->>'pressman','')),
  'die',coalesce(nullif(reference.specifications->>'suaje',''),nullif(field_values->>'die_identification','')),
  'crease',coalesce(nullif(reference.specifications->>'pleca',''),nullif(field_values->>'crease_identification','')),
  'material',coalesce(nullif(plan->>'material_code',''),nullif(plan->>'material_surface',''),nullif(field_values->>'material_code',''),nullif(field_values->>'material_surface','')),
  'priority',coalesce(nullif(plan->>'priority',''),nullif(field_values->>'priority','')),
  'measure',case when coalesce(plan->>'width_mm',nullif(field_values->>'width_mm','')) is not null
    and coalesce(plan->>'height_mm',nullif(field_values->>'height_mm','')) is not null
   then coalesce(plan->>'width_mm',field_values->>'width_mm')||' × '||coalesce(plan->>'height_mm',field_values->>'height_mm')||' mm'
   when nullif(die_data->>'axis_measure','') is not null and nullif(die_data->>'development_measure','') is not null
   then (die_data->>'axis_measure')||' × '||(die_data->>'development_measure') end,
  'speed',nullif(field_values->>'production_speed',''),'laminate',coalesce(nullif(field_values->>'lamination',''),nullif(plan->>'lamination','')),
  'plates',nullif(reference.specifications->>'placas',''),'colors_text',case when colors='[]' then coalesce(nullif(reference.specifications->>'colores',''),historical_colors) end,
  'inks',colors,'specifications',reference.specifications));
 return result||jsonb_build_object('reference',observed);
end $$;
revoke all on function public.prisma_recipe_reference(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_recipe_reference(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
