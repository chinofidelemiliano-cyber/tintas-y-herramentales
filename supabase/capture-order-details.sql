-- Ejecutar completo después de work-history-rewind.sql. No borra órdenes ni existencias.
begin;
alter table public.prisma_order_portal_submissions add column if not exists capture_hash text;
do $$begin
 if to_regprocedure('public.prisma_order_portal_capture_internal(text,jsonb)') is null then alter function public.prisma_order_portal(text,jsonb) rename to prisma_order_portal_capture_internal;end if;
 if to_regprocedure('public.prisma_press_sheets_capture_internal(jsonb)') is null then alter function public.prisma_press_sheets(jsonb) rename to prisma_press_sheets_capture_internal;end if;
end $$;
revoke all on function public.prisma_order_portal_capture_internal(text,jsonb),public.prisma_press_sheets_capture_internal(jsonb) from public,anon,authenticated;
create or replace function public.prisma_order_portal(access_key text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare input jsonb:=payload->'order';extra jsonb:='{}';result jsonb;field text;n numeric;row jsonb;rows jsonb:='[]';idx integer:=0;count_value integer;planned numeric;signature text;previous public.prisma_order_portal_submissions%rowtype;plan jsonb;
begin
 -- La cadena interna comprueba el enlace incluso al rechazar una captura.
 if payload->>'operation'<>'submit' then
  result:=public.prisma_order_portal_capture_internal(access_key,payload);
  if payload->>'operation'='list' then select coalesce(jsonb_agg(j||jsonb_build_object('capture_plan',coalesce(o.specifications->'production_plan','{}')) order by (j->>'queue_number')::bigint),'[]') into rows from jsonb_array_elements(result->'orders') j join public.prisma_orders o on o.id=(j->>'id')::bigint;result:=result||jsonb_build_object('orders',rows);end if;
  return result||jsonb_build_object('capture_version',2);
 end if;
 perform public.prisma_order_portal_capture_internal(access_key,jsonb_build_object('operation','catalog'));
 perform pg_advisory_xact_lock(104202611);
 if input->>'capture_version' is distinct from '2' then raise exception 'Actualiza la página de captura para completar todos los datos de la orden.';end if;
 if octet_length(input::text)>4000000 then raise exception 'La captura supera el tamaño permitido.';end if;
 foreach field in array array['turns_machine_1','turns_machine_2','turns_machine_3','category','material_surface','material_adhesive','material_liner','material_code','core_material','box_size','bag'] loop
  if jsonb_typeof(input->field) is distinct from 'string' or coalesce(btrim(input->>field),'')='' or length(input->>field)>200 then raise exception 'Completa los datos de material y empaque: %.',field;end if;extra:=extra||jsonb_build_object(field,btrim(input->>field));
 end loop;
 foreach field in array array['labels_per_roll','core_diameter','outer_diameter','rolls_per_box','expected_rewind_minutes','width_mm','height_mm'] loop
  if coalesce(input->>field,'') !~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' or length(input->>field)>80 then raise exception 'Completa medidas, etiquetas por rollo y empaque: %.',field;end if;n:=(input->>field)::numeric;if n<=0 or n>1e9 or (field in ('labels_per_roll','rolls_per_box') and n<>trunc(n)) or (field in ('width_mm','height_mm') and n>1e6) then raise exception 'Cantidad no válida: %.',field;end if;extra:=extra||jsonb_build_object(field,n);
 end loop;
 if coalesce(input->>'scrap_target','') !~ '^[0-9]+([.][0-9]+)?$' or (input->>'scrap_target')::numeric>100 then raise exception 'Captura el scrap objetivo de 0 a 100.';end if;extra:=extra||jsonb_build_object('scrap_target',(input->>'scrap_target')::numeric);
 if coalesce(input->>'required_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Captura la fecha solicitada.';end if;perform (input->>'required_date')::date;
 if coalesce(input->>'priority','') not in ('Baja','Normal','Alta','Urgente') then raise exception 'Selecciona la prioridad inicial.';end if;
 if coalesce(input->>'meters','') !~ '^[0-9]+([.][0-9]+)?$' or coalesce(input->>'reel_meters','') !~ '^[0-9]+([.][0-9]+)?$' or (input->>'meters')::numeric<=0 or (input->>'reel_meters')::numeric<=0 then raise exception 'Captura metros y metros por bobina.';end if;
 count_value:=ceil((input->>'meters')::numeric/(input->>'reel_meters')::numeric);if count_value>10000 or jsonb_typeof(input->'assigned_reels') is distinct from 'array' or jsonb_array_length(input->'assigned_reels')<>count_value then raise exception 'Completa las bobinas asignadas según el metraje.';end if;
 for row in select * from jsonb_array_elements(input->'assigned_reels') loop
  idx:=idx+1;for field in select unnest(array['identifier','lot']) loop if jsonb_typeof(row->field) is distinct from 'string' or coalesce(btrim(row->>field),'')='' or length(row->>field)>100 then raise exception 'Captura identificación y lote de bobina %.',idx;end if;end loop;
  foreach field in array array['width_mm','meters'] loop if coalesce(row->>field,'') !~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' or length(row->>field)>80 then raise exception 'Captura ancho y metros de bobina %.',idx;end if;n:=(row->>field)::numeric;if n<=0 or n>1e12 then raise exception 'Cantidad de bobina no válida.';end if;end loop;
  planned:=least((input->>'reel_meters')::numeric,(input->>'meters')::numeric-(idx-1)*(input->>'reel_meters')::numeric);if (row->>'meters')::numeric<planned then raise exception 'La bobina % no cubre sus metros programados.',idx;end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('number',idx,'identifier',btrim(row->>'identifier'),'lot',btrim(row->>'lot'),'width_mm',(row->>'width_mm')::numeric,'meters',(row->>'meters')::numeric));
 end loop;
 extra:=extra||jsonb_build_object('capture_version',2,'required_date',input->>'required_date','priority',input->>'priority','assigned_reels',rows);
 signature:=encode(sha256(convert_to(input::text,'UTF8')),'hex');select * into previous from public.prisma_order_portal_submissions where request_key=(payload->>'request_key')::uuid;
 if found then if previous.capture_hash is distinct from signature then raise exception 'La captura ya fue enviada con otros datos.';end if;return jsonb_build_object('id',previous.order_id,'queue_number',(select queue_number from public.prisma_orders where id=previous.order_id),'duplicate',true);end if;
 -- No enviar la tabla de bobinas a la función antigua, cuyo límite de entrada es 10 KB.
 result:=public.prisma_order_portal_capture_internal(access_key,jsonb_set(payload,'{order}',input-array['turns_machine_1','turns_machine_2','turns_machine_3','category','material_surface','material_adhesive','material_liner','material_code','core_material','box_size','bag','labels_per_roll','core_diameter','outer_diameter','rolls_per_box','expected_rewind_minutes','scrap_target','required_date','priority','assigned_reels','capture_version','production_plan']));
 select specifications->'production_plan' into plan from public.prisma_orders where id=(result->>'id')::bigint;
 update public.prisma_orders set specifications=specifications||jsonb_build_object('production_plan',coalesce(plan,'{}')||extra) where id=(result->>'id')::bigint;
 update public.prisma_order_portal_submissions set capture_hash=signature where request_key=(payload->>'request_key')::uuid;return result;
end $$;
create or replace function public.prisma_press_sheets(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;rows jsonb;begin
 result:=public.prisma_press_sheets_capture_internal(payload);
 if payload->>'operation'='list' and exists(select 1 from public.prisma_admins where user_id=auth.uid()) then
  select coalesce(jsonb_agg((to_jsonb(s)-'fields'-'runtime'-'source')||jsonb_build_object('source',s.source-'reportLogo','press_operator',o.press_operator,'rewind_operator',o.rewind_operator,'rewind_claimed_by',o.rewind_claimed_by) order by s.id desc),'[]') into rows from public.prisma_press_sheets s join public.prisma_orders o on o.id=s.order_id;result:=result||jsonb_build_object('sheets',rows);
 end if;return result;
end $$;
revoke all on function public.prisma_order_portal(text,jsonb),public.prisma_press_sheets(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_order_portal(text,jsonb) to anon,authenticated;
grant execute on function public.prisma_press_sheets(jsonb) to authenticated;
-- Las colas muestran la fecha solicitada y prioridad sin publicar material ni datos privados.
do $$begin if to_regprocedure('public.prisma_operator_queue_capture_internal(text,jsonb)') is null then alter function public.prisma_operator_queue(text,jsonb) rename to prisma_operator_queue_capture_internal;end if;end $$;
revoke all on function public.prisma_operator_queue_capture_internal(text,jsonb) from public,anon,authenticated;
create or replace function public.prisma_operator_queue(access_key text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;rows jsonb;begin result:=public.prisma_operator_queue_capture_internal(access_key,payload);
 select coalesce(jsonb_agg(jsonb_set(j,'{source}',(j->'source')||jsonb_build_object('production_plan',jsonb_build_object('required_date',s.source->'production_plan'->'required_date','priority',s.source->'production_plan'->'priority'))) order by (j->>'id')::bigint),'[]') into rows from jsonb_array_elements(result->'sheets') j join public.prisma_press_sheets s on s.id=(j->>'id')::bigint;return result||jsonb_build_object('sheets',rows);end $$;
revoke all on function public.prisma_operator_queue(text,jsonb) from public,anon,authenticated;
grant execute on function public.prisma_operator_queue(text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
