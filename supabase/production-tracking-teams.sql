-- Ejecuta TODO este archivo en SQL Editor. No modifica saldos ni consumos existentes.
begin;
alter table public.prisma_orders add column if not exists started_at timestamptz;
alter table public.prisma_orders add column if not exists ended_at timestamptz;
alter table public.prisma_orders add column if not exists np text not null default '';
alter table public.prisma_orders add column if not exists source text not null default 'manual';
alter table public.prisma_orders add column if not exists received_at timestamptz;
alter table public.prisma_orders add column if not exists scheduled_date date;
alter table public.prisma_orders add column if not exists scheduled_start text;
alter table public.prisma_orders add column if not exists scheduled_end text;
alter table public.prisma_orders add column if not exists pieces numeric;
alter table public.prisma_orders add column if not exists planned_meters numeric;
alter table public.prisma_orders add column if not exists specifications jsonb not null default '{}'::jsonb;
create table if not exists public.prisma_teams_connection (
 id integer primary key check(id=1),conversation_id text not null,token_hash text not null,enabled boolean not null default true,updated_at timestamptz not null default now()
);
create table if not exists public.prisma_teams_receipts (
 connection_hash text not null,conversation_id text not null,message_id text not null,order_ids jsonb not null,received_at timestamptz not null default now(),primary key(conversation_id,message_id)
);
alter table public.prisma_teams_connection enable row level security;
alter table public.prisma_teams_receipts enable row level security;
revoke all on public.prisma_teams_connection,public.prisma_teams_receipts from public,anon,authenticated;
create or replace function public.prisma_order_clock(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.prisma_orders%rowtype;op text:=payload->>'operation';stamp timestamptz;
begin
 perform public.prisma_authorize();perform pg_advisory_xact_lock(104202611);
 select * into r from public.prisma_orders where id=(payload->>'id')::bigint for update;
 if not found or r.status='cancelled' then raise exception 'Orden no encontrada o cancelada.';end if;
 stamp:=clock_timestamp();
 if op='start' then
  if r.ended_at is not null then raise exception 'La orden ya finalizó.';end if;
  update public.prisma_orders set started_at=coalesce(started_at,stamp) where id=r.id returning * into r;
 elsif op='finish' then
  if r.started_at is null then raise exception 'Primero inicia la orden.';end if;
  update public.prisma_orders set ended_at=coalesce(ended_at,stamp) where id=r.id returning * into r;
 else raise exception 'Acción de cronómetro no válida.';end if;
 return jsonb_build_object('id',r.id,'started_at',r.started_at,'ended_at',r.ended_at);
end $$;
create or replace function public.prisma_stop_cancelled_order() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if new.status='cancelled' and new.started_at is not null and new.ended_at is null then new.ended_at:=clock_timestamp();end if;
 return new;
end $$;
drop trigger if exists stop_cancelled_order on public.prisma_orders;
create trigger stop_cancelled_order before update of status on public.prisma_orders for each row execute function public.prisma_stop_cancelled_order();
create or replace function public.prisma_teams_connection(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare connection public.prisma_teams_connection%rowtype;secret text;chat text:=btrim(payload->>'conversation_id');
begin
 perform public.prisma_authorize();perform pg_advisory_xact_lock(104202611);
 if payload->>'operation'='configure' then
  if coalesce(chat,'')='' or length(chat)>500 then raise exception 'Captura el ID del chat autorizado.';end if;
  secret:='tt_'||encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex');
  insert into public.prisma_teams_connection(id,conversation_id,token_hash) values(1,chat,encode(sha256(convert_to(secret,'UTF8')),'hex'))
  on conflict(id) do update set conversation_id=excluded.conversation_id,token_hash=excluded.token_hash,enabled=true,updated_at=now();
 elsif payload->>'operation'='disable' then update public.prisma_teams_connection set enabled=false,updated_at=now() where id=1;
 elsif payload->>'operation'<>'status' then raise exception 'Acción no válida.';end if;
 select * into connection from public.prisma_teams_connection where id=1;
 return jsonb_build_object('enabled',coalesce(connection.enabled,false),'conversation_id',connection.conversation_id,'token',secret);
end $$;
create or replace function public.prisma_receive_teams(integration_token text,payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
<<receive>>
declare connection public.prisma_teams_connection%rowtype;ids jsonb;item jsonb;oid bigint;chat text:=payload->>'conversation_id';msg text:=payload->>'message_id';planned date;np_value text;folio_value text;
begin
 perform pg_advisory_xact_lock(104202611);
 if integration_token is null or integration_token !~ '^tt_[a-f0-9]{64}$' then raise exception 'Conexión no autorizada.';end if;
 select * into connection from public.prisma_teams_connection where id=1 and enabled and token_hash=encode(sha256(convert_to(integration_token,'UTF8')),'hex');
 if not found or connection.conversation_id is distinct from chat then raise exception 'Conexión o chat no autorizado.';end if;
 if coalesce(msg,'')='' or length(msg)>500 or octet_length(payload::text)>100000 or jsonb_typeof(payload->'orders') is distinct from 'array' then raise exception 'Mensaje no válido.';end if;
 if jsonb_array_length(payload->'orders') not between 1 and 10 then raise exception 'Se requieren de 1 a 10 órdenes.';end if;
 select order_ids into ids from public.prisma_teams_receipts where conversation_id=chat and message_id=msg;
 if found then return jsonb_build_object('ok',true,'duplicate',true,'order_ids',ids);end if;
 ids:='[]'::jsonb;
 for item in select value from jsonb_array_elements(payload->'orders') loop
  folio_value:=upper(btrim(item->>'folio'));np_value:=btrim(item->>'np');
  if folio_value is null or folio_value !~ '^OP-[A-Z0-9-]{1,95}$' or coalesce(np_value,'')='' or length(np_value)>100 or coalesce(btrim(item->>'product'),'')='' or length(item->>'product')>150 or length(coalesce(item->>'client',''))>150 then raise exception 'Falta orden, NP o producto válido.';end if;
  if item->>'scheduled_start' is not null and item->>'scheduled_start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or item->>'scheduled_end' is not null and item->>'scheduled_end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Hora programada no válida.';end if;
  planned:=nullif(item->>'scheduled_date','')::date;
  oid:=null;
  select id into oid from public.prisma_orders where source='teams' and status<>'cancelled' and folio=folio_value and np=np_value and scheduled_date is not distinct from planned order by id limit 1;
  if oid is not null then
   if exists(select 1 from public.prisma_orders where id=oid and (product is distinct from item->>'product' or client is distinct from coalesce(item->>'client','') or pieces is distinct from (item->>'pieces')::numeric or planned_meters is distinct from (item->>'meters')::numeric or scheduled_start is distinct from item->>'scheduled_start' or scheduled_end is distinct from item->>'scheduled_end' or specifications is distinct from coalesce(item->'specifications','{}'::jsonb))) then raise exception 'La orden ya existe con datos diferentes. Revísala en el inventario.';end if;
  else
   insert into public.prisma_orders(folio,np,client,product,date,status,source,received_at,scheduled_date,scheduled_start,scheduled_end,pieces,planned_meters,specifications)
   values(folio_value,np_value,coalesce(item->>'client',''),item->>'product',public.prisma_today(),'draft','teams',clock_timestamp(),planned,item->>'scheduled_start',item->>'scheduled_end',case when item->>'pieces' is null then null else public.prisma_number(item->>'pieces','Piezas') end,case when item->>'meters' is null then null else public.prisma_number(item->>'meters','Metros') end,coalesce(item->'specifications','{}'::jsonb)) returning id into oid;
  end if;
  ids:=ids||jsonb_build_array(oid);
 end loop;
 insert into public.prisma_teams_receipts(connection_hash,conversation_id,message_id,order_ids) values(connection.token_hash,chat,msg,ids);
 return jsonb_build_object('ok',true,'duplicate',false,'order_ids',ids);
end $$;
revoke all on function public.prisma_order_clock(jsonb),public.prisma_stop_cancelled_order(),public.prisma_teams_connection(jsonb),public.prisma_receive_teams(text,jsonb) from public,anon,authenticated;
grant execute on function public.prisma_order_clock(jsonb),public.prisma_teams_connection(jsonb) to authenticated;
-- Esta función solo admite importar órdenes y exige la clave de integración y el chat autorizado.
grant execute on function public.prisma_receive_teams(text,jsonb) to anon,authenticated;
notify pgrst, 'reload schema';
commit;
