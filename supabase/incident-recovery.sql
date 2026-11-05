-- Ejecutar completo después de accounts-and-sessions.sql. Conserva fotos, tiempos y folios.
begin;
create or replace function public.prisma_incident_np_valid(oid bigint,np_value text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(btrim(np_value),'')='' or exists(select 1 from public.prisma_orders where id=oid and btrim(np)=btrim(np_value)) or exists(select 1 from public.prisma_items where order_id=oid and btrim(np)=btrim(np_value));
$$;
create or replace function public.prisma_start_incident_internal(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b jsonb:=payload;old public.prisma_incidents%rowtype;o public.prisma_orders%rowtype;n integer;record_id bigint;start_time timestamptz:=clock_timestamp();np_value text;key text;
begin
 perform public.prisma_require_permission('incidents');perform pg_advisory_xact_lock(104202611);
 key:=nullif(b->>'request_key','');
 if key is not null then select * into old from public.prisma_incidents where request_key=key;if found then
  if old.order_id is distinct from (b->>'order_id')::bigint or not old.timer_mode then raise exception 'La captura ya está vinculada a otro registro.';end if;
  return jsonb_build_object('ok',true,'id',old.id,'folio','INC-'||lpad(old.incident_number::text,greatest(4,length(old.incident_number::text)),'0'),'started_at',old.started_at);
 end if;end if;
 select * into o from public.prisma_orders where id=(b->>'order_id')::bigint;if not found then raise exception 'Selecciona una orden registrada.';end if;
 select coalesce(max(incident_number),10)+1 into n from public.prisma_incidents;
 select case when count(distinct np)=1 then min(np) else '' end into np_value from (select nullif(btrim(o.np),'') as np union select nullif(btrim(i.np),'') from public.prisma_items i where i.order_id=o.id)x where np is not null;
 if nullif(btrim(b->>'np'),'') is not null then np_value:=btrim(b->>'np');end if;
 if not public.prisma_incident_np_valid(o.id,np_value) then raise exception 'El NP no pertenece a esa orden.';end if;
 insert into public.prisma_incidents(incident_number,date,order_id,order_ref,np,machine,description,responsible,impact,status,request_key,timer_mode,started_at) values(n,public.prisma_today(),o.id,o.folio,coalesce(np_value,''),'','Registro en curso','','','Abierta',key,true,start_time) returning id into record_id;
 return jsonb_build_object('ok',true,'id',record_id,'folio','INC-'||lpad(n::text,greatest(4,length(n::text)),'0'),'started_at',start_time);
end $$;
create or replace function public.prisma_update_timed_incident(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b jsonb:=payload;r public.prisma_incidents%rowtype;finish boolean;before_value text;after_value text;ending timestamptz;np_value text;machine_value text;responsible_value text;impact_value text;
begin
 perform public.prisma_require_permission('incidents');perform pg_advisory_xact_lock(104202611);
 select * into r from public.prisma_incidents where id=(b->>'id')::bigint;if not found or not r.timer_mode then raise exception 'Cronómetro no encontrado.';end if;
 if r.order_id is distinct from (b->>'order_id')::bigint then raise exception 'No se puede cambiar la orden del cronómetro.';end if;
 finish:=coalesce((b->>'finish')::boolean,false) or r.ended_at is not null;
 before_value:=case when b?'before_photo' then b->>'before_photo' else r.before_photo end;after_value:=case when b?'after_photo' then b->>'after_photo' else r.after_photo end;
 perform public.prisma_check_incident_photo(before_value);perform public.prisma_check_incident_photo(after_value);
 if finish and (coalesce(before_value,'')='' or coalesce(after_value,'')='') then raise exception 'Agrega la foto del defecto y la foto final.';end if;
 machine_value:=coalesce(b->>'machine',r.machine);responsible_value:=coalesce(b->>'responsible',r.responsible);impact_value:=coalesce(b->>'impact',r.impact);np_value:=btrim(coalesce(b->>'np',r.np));
 if machine_value<>'' and machine_value not in ('Mark Andy','Comco 1','Comco 2','Maquina China') then raise exception 'Máquina no válida.';end if;
 if responsible_value<>'' and responsible_value not in ('Diseño','Producción','Preprensa','Proveedor','Mantenimiento','Compartida') then raise exception 'Responsable no válido.';end if;
 if impact_value<>'' and impact_value not in ('Merma','Paro','Retrabajo','Calidad','Entrega','Otro') then raise exception 'Impacto no válido.';end if;
 if not public.prisma_incident_np_valid(r.order_id,np_value) then raise exception 'NP no válido.';end if;
 ending:=coalesce(r.ended_at,case when finish then clock_timestamp() else null end);
 update public.prisma_incidents set np=np_value,machine=machine_value,responsible=responsible_value,impact=impact_value,description=coalesce(nullif(b->>'description',''),r.description),action=coalesce(nullif(b->>'action',''),case when finish then 'Corrección documentada en fotografía final.' else r.action end),status=case when finish then 'Cerrada' else 'Abierta' end,prepared_by=coalesce(b->>'prepared_by',r.prepared_by),color_observed=coalesce(b->>'color_observed',r.color_observed),test_result=coalesce(b->>'test_result',r.test_result),validation_notes=coalesce(b->>'validation_notes',r.validation_notes),before_photo=before_value,after_photo=after_value,ended_at=ending where id=r.id;
 return jsonb_build_object('ok',true,'id',r.id,'folio','INC-'||lpad(r.incident_number::text,greatest(4,length(r.incident_number::text)),'0'),'started_at',r.started_at,'ended_at',ending);
end $$;
create or replace function public.prisma_save_incident_internal(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
<<inc>>
declare b jsonb:=payload;d date;oid bigint;ref text;record_id bigint;folio_number integer;np_value text;key text;
begin
 perform public.prisma_require_permission('incidents');perform pg_advisory_xact_lock(104202611);
 key:=nullif(b->>'request_key','');record_id:=nullif(b->>'id','')::bigint;
 if record_id is not null and exists(select 1 from public.prisma_incidents where id=record_id and timer_mode) then return public.prisma_update_timed_incident(b);end if;
 if key is not null and record_id is null then
  select id,incident_number into record_id,folio_number from public.prisma_incidents where request_key=key;
  if found then return jsonb_build_object('ok',true,'id',record_id,'folio','INC-'||lpad(folio_number::text,greatest(4,length(folio_number::text)),'0'));end if;
 end if;
 if coalesce(b->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Fecha no válida.';end if;
 d:=(b->>'date')::date;if d>public.prisma_today() then raise exception 'No se permiten incidencias con fecha futura.';end if;
 oid:=nullif(b->>'order_id','')::bigint;select folio into ref from public.prisma_orders where id=oid;if not found then raise exception 'Selecciona una orden de producción registrada.';end if;
 np_value:=btrim(coalesce(b->>'np',''));if not public.prisma_incident_np_valid(oid,np_value) then raise exception 'El NP no pertenece a esa orden.';end if;
 if b->>'machine' is null or b->>'machine' not in ('Mark Andy','Comco 1','Comco 2','Maquina China') then raise exception 'Máquina no válida.';end if;
 if b->>'responsible' is null or b->>'responsible' not in ('Diseño','Producción','Preprensa','Proveedor','Mantenimiento','Compartida') then raise exception 'Responsable no válido.';end if;
 if b->>'impact' is null or b->>'impact' not in ('Merma','Paro','Retrabajo','Calidad','Entrega','Otro') then raise exception 'Impacto no válido.';end if;
 if b->>'status' is null or b->>'status' not in ('Abierta','En seguimiento','Cerrada') then raise exception 'Estatus no válido.';end if;
 if coalesce(btrim(b->>'description'),'')='' then raise exception 'Describe la incidencia.';end if;
 if b->>'status'='Cerrada' and coalesce(btrim(b->>'action'),'')='' then raise exception 'Captura la acción realizada antes de cerrar la incidencia.';end if;
 if record_id is null then
  select coalesce(max(incident_number),10)+1 into folio_number from public.prisma_incidents;
  insert into public.prisma_incidents(incident_number,date,order_id,order_ref,np,machine,description,responsible,action,impact,status,prepared_by,color_observed,test_result,validation_notes,request_key) values(folio_number,d,oid,ref,np_value,b->>'machine',b->>'description',b->>'responsible',coalesce(b->>'action',''),b->>'impact',b->>'status',coalesce(b->>'prepared_by',''),coalesce(b->>'color_observed',''),coalesce(b->>'test_result',''),coalesce(b->>'validation_notes',''),key) returning id into record_id;
 else
  update public.prisma_incidents set date=d,order_id=oid,order_ref=ref,np=np_value,machine=b->>'machine',description=b->>'description',responsible=b->>'responsible',action=coalesce(b->>'action',''),impact=b->>'impact',status=b->>'status',prepared_by=coalesce(b->>'prepared_by',''),color_observed=coalesce(b->>'color_observed',''),test_result=coalesce(b->>'test_result',''),validation_notes=coalesce(b->>'validation_notes','') where id=record_id returning incident_number into folio_number;
  if not found then raise exception 'Incidencia no encontrada.';end if;
 end if;
 return jsonb_build_object('ok',true,'id',record_id,'folio','INC-'||lpad(folio_number::text,greatest(4,length(folio_number::text)),'0'));
end $$;
create or replace function public.prisma_start_incident(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$begin perform public.prisma_require_permission('incidents');return public.prisma_start_incident_internal(payload);end $$;
create or replace function public.prisma_save_incident(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$begin perform public.prisma_require_permission('incidents');return public.prisma_save_incident_internal(payload);end $$;
revoke all on function public.prisma_incident_np_valid(bigint,text),public.prisma_start_incident_internal(jsonb),public.prisma_save_incident_internal(jsonb),public.prisma_update_timed_incident(jsonb),public.prisma_start_incident(jsonb),public.prisma_save_incident(jsonb) from public,anon,authenticated;
grant execute on function public.prisma_start_incident(jsonb),public.prisma_save_incident(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
