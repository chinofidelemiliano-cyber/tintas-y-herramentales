begin;

-- Adapt the two existing validation points, keeping the rest of the installed capture chain.
do $migration$
declare original text; changed text;
begin
 original:=pg_get_functiondef('public.prisma_order_portal_profiles_internal(text,jsonb)'::regprocedure);
 if position('classified_print_only' in original)=0 then
  changed:=replace(original,$old$or coalesce(input->>'die_id','') !~ '^[1-9][0-9]*$'$old$,
   $new$or (coalesce(input->>'production_type','')<>'print' and coalesce(input->>'die_id','') !~ '^[1-9][0-9]*$') /* classified_print_only */$new$);
  if original=changed then raise exception 'La validación de planeación instalada no coincide con la esperada.'; end if;
  execute changed;
 end if;
 original:=pg_get_functiondef('public.prisma_order_portal_ink_internal(text,jsonb)'::regprocedure);
 if position('classified_no_ink' in original)=0 then
  changed:=replace(original,$old$coalesce(btrim(b->>field),'')='' or length(b->>field)>maxlen$old$,
   $new$(coalesce(btrim(b->>field),'')='' and not (field='colors' and
    (coalesce(b->>'production_type','')='cut' or (coalesce(b->>'production_type','')='white' and coalesce(b->>'white_process','')='material')))) or length(b->>field)>maxlen /* classified_no_ink */$new$);
  if original=changed then raise exception 'La validación de tintas instalada no coincide con la esperada.'; end if;
  execute changed;
 end if;
end
$migration$;

do $$
begin
 if to_regprocedure('public.prisma_order_portal_classification_internal(text,jsonb)') is null then
  alter function public.prisma_order_portal(text,jsonb) rename to prisma_order_portal_classification_internal;
 end if;
end $$;
revoke all on function public.prisma_order_portal_classification_internal(text,jsonb) from public,anon,authenticated;

create or replace function public.prisma_order_portal_classified(access_key text,payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 input jsonb:=payload->'order';
 kind text:=input->>'production_type';
 white text:=input->>'white_process';
 plates text:=trim(coalesce(input->>'plates',''));
 printing boolean;
 cutting boolean;
 inks jsonb:=coalesce(input->'ink_selections','[]');
 result jsonb;
 classification jsonb;
begin
 if payload->>'operation' is distinct from 'submit' then
  return public.prisma_order_portal_classification_internal(access_key,payload)||jsonb_build_object('production_types_version',1);
 end if;
 perform public.prisma_order_portal_classification_internal(access_key,jsonb_build_object('operation','catalog'));
 if kind is null or kind not in ('cut','print_cut','print','white') then
  raise exception 'Selecciona el tipo de producción.';
 end if;
 if kind='white' and coalesce(white,'') not in ('material','ink') then
  raise exception 'Indica el proceso de la etiqueta blanca.';
 end if;
 printing:=kind in ('print','print_cut') or (kind='white' and white='ink');
 cutting:=kind<>'print';
 if jsonb_typeof(inks)<>'array' then raise exception 'Revisa las posiciones de color.'; end if;
 if printing and (length(plates) not between 1 and 200 or jsonb_array_length(inks)=0) then
  raise exception 'Captura las placas o clichés y selecciona al menos una tinta o Pantone.';
 end if;
 if not printing and (plates<>'' or coalesce(input->>'colors','')<>'' or jsonb_array_length(inks)>0 or nullif(input->>'ink_family','') is not null) then
  raise exception 'Este proceso no admite datos de impresión.';
 end if;
 if cutting and coalesce(input->>'die_id','') !~ '^[1-9][0-9]*$' then
  raise exception 'Selecciona el suaje para el corte.';
 end if;
 if not cutting then
  if nullif(input->>'die_id','') is not null or nullif(input->>'crease_id','') is not null or input->>'has_crease'='yes' then
   raise exception 'Solo impresión no admite herramentales de corte.';
  end if;
  input:=input||jsonb_build_object('has_crease','no');
 end if;
 classification:=jsonb_build_object('production_type',kind,'white_process',case when kind='white' then white end,'plates',plates);
 input:=input||classification||jsonb_build_object('colors',case when printing then coalesce(nullif(input->>'colors',''),'Tintas de la orden') else '' end);
 result:=public.prisma_order_portal_classification_internal(access_key,jsonb_set(payload,'{order}',input));
 if not coalesce((result->>'duplicate')::boolean,false) then
  update public.prisma_orders set specifications=
   jsonb_set(specifications,'{production_plan}',coalesce(specifications->'production_plan','{}')||classification)
   ||case when printing then jsonb_build_object('placas',plates) else '{}'::jsonb end
  where id=(result->>'id')::bigint;
 end if;
 return result;
end $$;
revoke all on function public.prisma_order_portal_classified(text,jsonb) from public,anon,authenticated;
do $$
begin
 if to_regprocedure('public.prisma_order_portal_die_material_internal(text,jsonb)') is null then
  execute $wrapper$
   create or replace function public.prisma_order_portal(access_key text,payload jsonb) returns jsonb
   language sql security definer set search_path=public,pg_temp as
   'select public.prisma_order_portal_classified(access_key,payload)'
  $wrapper$;
  revoke all on function public.prisma_order_portal(text,jsonb) from public,anon,authenticated;
  grant execute on function public.prisma_order_portal(text,jsonb) to anon,authenticated;
 end if;
end $$;
create or replace function public.prisma_prevent_unprinted_ink() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare plan jsonb;
begin
 select specifications->'production_plan' into plan from public.prisma_orders where id=new.order_id;
 if plan->>'production_type'='cut' or plan->>'white_process'='material' then
  raise exception 'Este proceso no genera pesajes de tinta.';
 end if;
 return new;
end $$;
revoke all on function public.prisma_prevent_unprinted_ink() from public,anon,authenticated;
drop trigger if exists prisma_prevent_unprinted_ink on public.prisma_items;
create trigger prisma_prevent_unprinted_ink before insert or update of order_id on public.prisma_items
 for each row execute function public.prisma_prevent_unprinted_ink();

create or replace function public.prisma_close_without_ink(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.prisma_orders%rowtype; plan jsonb; meters numeric;
begin
 perform public.prisma_require_permission('production');
 perform pg_advisory_xact_lock(104202611);
 select * into o from public.prisma_orders where id=(payload->>'id')::bigint for update;
 plan:=o.specifications->'production_plan';
 if not found or o.ended_at is null or o.status='cancelled'
  or coalesce(plan->>'production_type'='cut' or plan->>'white_process'='material',false) is false then
  raise exception 'Selecciona una orden sin impresión cuya preparación ya terminó.';
 end if;
 if coalesce(payload->>'meters','') !~ '^[0-9]+([.][0-9]{1,3})?$' then raise exception 'Captura metros reales válidos.'; end if;
 meters:=(payload->>'meters')::numeric;
 if meters<=0 or meters>1e12 then raise exception 'Captura metros reales válidos.'; end if;
 if o.status='confirmed' and o.specifications->>'actual_cut_meters' is not null
  and meters=(o.specifications->>'actual_cut_meters')::numeric then return jsonb_build_object('id',o.id); end if;
 if o.status<>'draft' then raise exception 'La orden ya está cerrada.'; end if;
 perform public.prisma_date(o.date::text);
 update public.prisma_orders set status='confirmed',specifications=specifications||jsonb_build_object('actual_cut_meters',meters)
 where id=o.id;
 return jsonb_build_object('id',o.id);
end $$;
revoke all on function public.prisma_close_without_ink(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_close_without_ink(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
