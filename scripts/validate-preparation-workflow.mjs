import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const packagePath=process.env.PRISMA_PGLITE_MODULE;
const {PGlite}=await import(packagePath||'@electric-sql/pglite');
const {pgcrypto}=await import(packagePath?new URL('./contrib/pgcrypto.js','file://'+packagePath).href:'@electric-sql/pglite/contrib/pgcrypto');
const db=new PGlite({extensions:{pgcrypto}});
await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth;create schema extensions;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz, confirmation_sent_at timestamptz, raw_user_meta_data jsonb,created_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;`);
await db.exec(`create schema cron;create table cron.job(jobname text);create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;create function cron.unschedule(text) returns boolean language sql as $$select true$$;`);
const setup=readFileSync(new URL('../supabase/setup.sql',import.meta.url),'utf8').replace(/create extension if not exists pg_(net|cron) with schema [a-z_]+;/g,'');
const migration=readFileSync(new URL('../supabase/preparation-workflow.sql',import.meta.url),'utf8');
try{await db.exec(setup);}catch(e){console.error(e.message, e.internalQuery);process.exit(1);}
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
await db.query('insert into auth.users(id) values($1),($2)',[a,b]);
await db.query('insert into public.prisma_members(user_id) values($1),($2)',[a,b]);
await db.query('insert into public.prisma_admins(user_id) values($1)',[a]);
await db.exec("insert into public.prisma_orders(id,folio,client,date,status) values(5001,'PREP-1','Prueba',current_date,'draft'),(5002,'PREP-2','Prueba',current_date,'draft'),(5003,'PREP-3','Prueba',current_date,'draft');");
await db.exec(migration);
await db.exec(migration);
const user=async id=>db.exec(`reset role;set request.jwt.claim.sub='${id}';set role authenticated;`);
const rpc=async (name,payload)=>(await db.query(`select public.prisma_${name}($1::jsonb) as value`,[JSON.stringify(payload)])).rows[0].value;
const run=(op,id=5001,version)=>rpc('order_clock',{id,operation:op,version});
const workflow=(operation,extra)=>rpc('preparation_workflow',{operation,...extra});
await user(a);
assert.equal((await workflow('list')).reminders.first_minutes,30);
await assert.rejects(workflow('reminders',{first_minutes:50,second_minutes:30}),/umbrales/);
await workflow('reminders',{first_minutes:15,second_minutes:45,shift_end:'16:30'});
assert.deepEqual((await workflow('list')).reminders,{first_minutes:15,second_minutes:45,shift_end:'16:30:00'});
await run('start');
const initial=(await workflow('list')).clocks[0];
assert.equal(initial.responsible,a);
await assert.rejects(run('start',5002),/Ya tienes/);
await assert.rejects(run('pause',5001,99),/cambió/);
await run('pause',5001,0);
assert.ok((await workflow('list')).clocks[0].paused_at);
await user(b);
assert.equal((await workflow('list')).clocks.length,0);
await assert.rejects(run('resume',5001,1),/administrador/);
await assert.rejects(workflow('history',{id:5001}),/administrador/);
await assert.rejects(db.query('delete from public.prisma_preparation_audit'),/permission denied/);
await run('start',5002);
await user(a);
await run('resume',5001,1);
assert.equal((await workflow('list')).clocks.find(c=>c.order_id===5001).paused_at,null);
await db.exec("reset role; update public.prisma_orders set status='cancelled', ended_at=clock_timestamp() where id=5001;");
await user(a);
await run('start',5003);
const {fields,revision}=await workflow('edit_fields',{id:5003});
const edit={id:5003,revision,fields:{...fields,notes:'Verificar muestra',machine:'Mark Andy',required_date:'2027-01-17',priority:'Alta',estimated_minutes:20},reason:'Ajustar entrega'};
await workflow('edit_order',edit);
await assert.rejects(workflow('edit_order',edit),/cambió/);
const updated=(await workflow('list')).clocks.find(c=>c.order_id===5003);
assert.ok(updated.changed_at);
assert.equal(updated.items.length,1);
assert.equal(updated.items[0].label,'Verificar muestra');
await assert.rejects(workflow('check_item',{id:5003,version:0,key:'invalid',status:'ready'}),/no válido/);
const checked=await workflow('check_item',{id:5003,version:0,key:updated.items[0].key,status:'ready'});
assert.equal(checked.items[0].status,'ready');
await db.query('reset role');
await db.query("update public.prisma_orders set started_at=clock_timestamp()- interval '5 minutes' where id=5003");
await user(a);
const finished=await run('finish',5003,1);
assert.equal(finished.press_sheet.order_id,5003);
assert.equal((await run('finish',5003,1)).press_sheet.id,finished.press_sheet.id);
const started=new Date(finished.started_at).toISOString();
const ended=new Date(finished.ended_at).toISOString();
const body={id:5003,version:2,started_at:started,ended_at:ended,effective_seconds:200,paused_seconds:60,idle_seconds:40,reason:'Interrupción'};
await assert.rejects(workflow('correct',{...body,effective_seconds:190}),/suma/);
await workflow('correct',body);
await assert.rejects(workflow('correct',body),/cambió/);
const history=(await workflow('history',{id:5003})).history;
assert.deepEqual(history.map(x=>x.operation),['correct','check_item','edit_order']);
assert.ok(Math.abs(history[0].before_value.effective_seconds-300)<1);
assert.equal(history[0].after_value.effective_seconds,200);
await assert.rejects(run('start',5001),/cancelada/);
const preserved=(await db.query('select public.prisma_work_history($1::jsonb) as value',[JSON.stringify({operation:'list'})])).rows[0].value;
assert.ok(JSON.stringify(preserved).includes('"net_seconds":200'));
await db.exec('reset role');
const raw=(await db.query('select started_at,ended_at from public.prisma_orders where id=5003')).rows[0];
assert.equal(raw.started_at.toISOString(),started);
assert.equal(raw.ended_at.toISOString(),ended);
await db.exec('set role anon');
await assert.rejects(workflow('list'),/permission denied/);
await db.exec('reset role');
for(const file of ['production-types.sql','die-compatibility.sql','ink-reservations.sql','preparation-indicators.sql','closed-order-tooling.sql']){
 const sql=readFileSync(new URL('../supabase/'+file,import.meta.url),'utf8');
 await db.exec(sql);
 await db.exec(sql);
}
const key='op_'+'a'.repeat(64);
await db.query("insert into public.prisma_order_portal_access(id,token_hash,enabled) values(1,encode(sha256(convert_to($1,'UTF8')),'hex'),true) on conflict(id) do update set token_hash=excluded.token_hash,enabled=true",[key]);
const cutDie=(await db.query("select id from public.prisma_products where code like 'SJ%' limit 1")).rows[0].id;
const shared={
 capture_version:2,production_type:'cut',folio:'TYPE-CUT',np:'NP',product:'Etiqueta',pressman:'Julio Rocha',rewind_operator:'AA',
 machine:'Comco 1',scheduled_date:'2026-11-24',scheduled_start:'08:00',requested_thousands:10,pieces:10000,
 reel_meters:1500,expected_bobina_minutes:10,expected_production_minutes:20,finish:'Sin acabado',has_crease:'no',die_id:cutDie,
 turns_machine_1:'NA',turns_machine_2:'NA',turns_machine_3:'NA',required_date:'2026-11-30',priority:'Normal',category:'Etiqueta',
 scrap_target:5,width_mm:100,height_mm:50,labels_per_roll:1000,core_diameter:76,outer_diameter:170,rolls_per_box:6,
 expected_rewind_minutes:30,material_surface:'BOPP',material_adhesive:'Permanente',material_liner:'Kraft',material_code:'MAT-PRUEBA',
 core_material:'Cartón',box_size:'400x300',bag:'Sí',meters:100,assigned_reels:[{identifier:'B1',lot:'L1',width_mm:200,meters:100}],
 ink_selections:[],colors:''
};
const portal=async payload=>(await db.query('select public.prisma_order_portal($1,$2::jsonb) as value',[key,JSON.stringify(payload)])).rows[0].value;
const request_key='00000000-0000-4000-8000-000000000001';
await db.exec('set role anon');
assert.equal((await portal({operation:'catalog'})).production_types_version,1);
await assert.rejects(portal({operation:'submit',request_key,order:{...shared,production_type:undefined}}),/tipo de producción/);
await assert.rejects(portal({operation:'submit',request_key,order:{...shared,ink_selections:[{slot:1,pantone:'123'}]}}),/no admite/);
const captured=await portal({operation:'submit',request_key,order:shared});
assert.equal((await portal({operation:'submit',request_key,order:shared})).id,captured.id);
const print=await portal({operation:'submit',request_key:'00000000-0000-4000-8000-000000000002',order:{
 ...shared,folio:'TYPE-PRINT',production_type:'print',die_id:null,plates:'PLC-1',ink_selections:[{slot:1,pantone:'123',ink_family:'UV'}]
}});
await db.exec('reset role');
const records=(await db.query("select id,specifications,ink_selections from public.prisma_orders where folio like 'TYPE-%' order by id")).rows;
assert.equal(records[0].specifications.production_plan.production_type,'cut');
assert.equal(records[0].specifications.colores,'');
assert.deepEqual(records[0].ink_selections,[]);
assert.equal(records[1].specifications.placas,'PLC-1');
assert.equal(records[1].specifications.die_id,undefined);
assert.equal((await db.query('select count(*)::int as count from public.prisma_pantone_requests where order_id=$1',[print.id])).rows[0].count,1);
const compatibility=(operation,extras={})=>rpc('die_material',{operation,id:captured.id,...extras});
await user(a);
assert.equal((await compatibility('get')).status,'unverified');
await compatibility('rule',{compatible:false,reason:'Evaluación técnica de prueba'});
await assert.rejects(run('start',captured.id),/SUAJE NO COMPATIBLE/);
await user(b);
await assert.rejects(compatibility('authorized',{reason:'Prueba'}),/permiso/);
await user(a);
await compatibility('authorized',{reason:'Excepción documentada'});
await run('start',captured.id);
assert.ok((await compatibility('get')).events.some(event=>event.decision==='authorized'));
const cutClock=(await workflow('list')).clocks.find(clock=>clock.order_id===captured.id);
await workflow('check_item',{id:captured.id,version:cutClock.version,key:cutClock.items[0].key,status:'unavailable'});
await run('finish',captured.id,cutClock.version+1);
await db.exec('reset role');
const cutMonth=(await db.query("select to_char(date,'YYYY-MM') as month from public.prisma_orders where id=$1",[captured.id])).rows[0].month;
await user(a);
const events=(await rpc('preparation_indicator_events',{month:cutMonth})).orders.find(order=>order.id===captured.id);
assert.equal(events.material_shortage,true);
assert.equal(events.incompatible,true);
await workflow('handoff',{id:captured.id});
await workflow('handoff',{id:captured.id});
assert.ok((await workflow('list')).clocks.find(c=>c.order_id===captured.id).handed_off_at);
await rpc('close_without_ink',{id:captured.id,meters:75});
await rpc('close_without_ink',{id:captured.id,meters:75});
await db.exec('reset role');
const inkLot=(await db.query("select l.id,l.product_id,l.grams from public.prisma_lots l join public.prisma_products p on p.id=l.product_id where p.category='tinta' and l.grams>20 limit 1")).rows[0];
await user(a);
const printEdit=await workflow('edit_fields',{id:print.id});
await workflow('edit_order',{id:print.id,revision:printEdit.revision,reason:'Cambio de color',fields:{
 ...printEdit.fields,ink_selections:[{slot:1,product_id:inkLot.product_id,pantone:''}]
}});
const reserve=(operation,payload={})=>rpc('manage_ink_reservations',{operation,id:print.id,...payload});
const reservation=await reserve('get');
const hold={revision:reservation.revision,reason:'Producción programada',reservations:[{lot_id:inkLot.id,grams:10}]};
await reserve('save',hold);
await assert.rejects(reserve('save',hold),/cambiaron/);
await db.exec('reset role');
await assert.rejects(db.query('update public.prisma_lots set grams=5 where id=$1',[inkLot.id]),/reservados/);
assert.equal((await db.query('select count(*)::int as count from public.prisma_pantone_requests where order_id=$1',[print.id])).rows[0].count,0);
await db.query("update public.prisma_members set permissions=array_append(permissions,'preparation_edit') where user_id=$1",[b]);
await user(b);
const delegated=await workflow('edit_fields',{id:print.id});
await workflow('edit_order',{id:print.id,revision:delegated.revision,reason:'Cambiar solicitud',fields:{
 ...delegated.fields,ink_selections:[{slot:1,product_id:null,pantone:'332 C'}]
}});
assert.deepEqual((await reserve('get')).reservations,[]);
await assert.rejects(workflow('correct',{id:captured.id}),/permiso/);
const correctTool=(operation,kind,extra={})=>rpc('closed_order_tooling',{operation,kind,id:captured.id,...extra});
const correction=await correctTool('get','suaje');
await assert.rejects(correctTool('save','suaje',{revision:correction.revision,product_id:inkLot.product_id,reason:'Error de captura'}),/herramental válido/);
await correctTool('save','suaje',{revision:correction.revision,unidentified:true,reason:'Herramental pendiente de confirmar'});
await assert.rejects(correctTool('save','suaje',{revision:correction.revision,product_id:cutDie,reason:'Error de captura'}),/cambió/);
const unknown=await correctTool('get','suaje');
assert.equal(unknown.label,null);
assert.equal(Number(unknown.history[0].before.product_id),Number(cutDie));
await correctTool('save','suaje',{revision:unknown.revision,product_id:cutDie,reason:'Confirmación del suaje'});
const restored=(await correctTool('get','suaje')).history;
assert.equal(restored.length,2);
assert.equal(Number(restored[0].after.product_id),Number(cutDie));
await db.exec('reset role');
const closed=(await db.query('select status,specifications from public.prisma_orders where id=$1',[captured.id])).rows[0];
assert.equal(closed.status,'confirmed');
assert.equal(closed.specifications.actual_cut_meters,75);
for(const file of ['plant-controls.sql','plant-alerts.sql']){
 const sql=readFileSync(new URL('../supabase/'+file,import.meta.url),'utf8');
 await db.exec(sql);
 await db.exec(sql);
}
const seedPath=process.env.PRISMA_PLANT_SEED;
const testCatalog=`insert into public.prisma_plant_catalog(kind,code,details) values
 ('anilox','AX1','{"lpi":225,"bcm":6.7}'),
 ('part','NP001-1','{"names":["Producto de prueba"]}'),
 ('part','NP136-1','{"names":["Variante de prueba A","Variante de prueba B"]}')
 on conflict(kind,code) do nothing;`;
await db.exec(seedPath?readFileSync(seedPath,'utf8'):testCatalog);
await user(a);
const plant=(operation,extra={})=>rpc('plant_controls',{operation,...extra});
const catalog=await plant('tools');
assert.equal(catalog.anilox.length,seedPath?41:1);
assert.ok(catalog.dies.length>10);
const parts=(await plant('parts')).parts;
assert.equal(parts.length,seedPath?408:2);
assert.equal(parts.find(part=>part.code==='NP136-1').names.length,2);
const inkPlan=(await plant('ink_list')).inks[0];
await plant('ink_settings',{id:inkPlan.id,category:'A',indispensable:true,lead_days:7,review_days:14,safety_days:3});
await plant('ink_ordered',{id:inkPlan.id,ordered:true});
await plant('ink_measure',{id:inkPlan.id,ph:8.1,viscosity:'22',viscosity_unit:'s · Copa Zahn 2',drying:'Correcto'});
assert.equal((await plant('ink_history',{id:inkPlan.id})).parameters.length,1);
const die=catalog.dies[0];
await plant('save_catalog',{kind:'die',code:die.code,details:{initial_regrinds:4,serial:'VALIDACIÓN'}});
const batch=await plant('service_batch',{kind:'die',service:'resharpen',due_on:catalog.today,codes:[die.code],deliverer:'Entrega',recipient:'Recibe'});
assert.equal(batch.services.length,1);
await assert.rejects(plant('service_batch',{kind:'die',service:'resharpen',due_on:catalog.today,codes:[die.code],deliverer:'Entrega',recipient:'Recibe'}));
await plant('complete_service',{id:batch.services[0].id,received_on:catalog.today,passes:'yes',gear:'yes',material:'Papel',received_by:'Recepción'});
assert.equal((await plant('tools')).dies.find(item=>item.code===die.code).regrinds,5);
await plant('save_catalog',{kind:'recipe',code:'NP001-1',details:{stations:[{slot:1,color:'Azul',anilox:'AX1'}]}});
assert.equal((await plant('recipe',{code:'NP001-1'})).recipe.stations[0].anilox,'AX1');
const [variant,otherVariant]=parts.find(part=>part.code==='NP136-1').names;
await plant('save_catalog',{kind:'recipe',code:'NP136-1',product:variant,details:{stations:[{slot:1,color:'Verde'}]}});
assert.equal((await plant('recipe',{code:'NP136-1',product:variant})).recipe.stations[0].color,'Verde');
assert.equal((await plant('recipe',{code:'NP136-1',product:otherVariant})).recipe,null);
await assert.rejects(plant('recipe',{code:'NP136-1'}),/productos distintos/);
await db.exec('reset role');
assert.equal((await db.query('select public.prisma_queue_plant_alerts() as queued')).rows[0].queued,0);
await db.exec(`create schema net;
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;
 insert into public.prisma_notification_config(id,public_key,private_key,subject,dispatch_secret,edge_url)
 values(1,'test','test','test','test','https://example.test');`);
await db.query(`insert into public.prisma_notification_devices(user_id,device_key,label,origin,endpoint,p256dh,auth_key)
 values($1,gen_random_uuid(),'browser','https://example.test','https://example.test/push','test','test')`,[a]);
assert.ok((await db.query('select public.prisma_queue_plant_alerts() as queued')).rows[0].queued>=1);
assert.equal((await db.query('select public.prisma_queue_plant_alerts() as queued')).rows[0].queued,0);
await db.exec('set role service_role');
const push=(await db.query('select public.prisma_claim_push_jobs() as jobs')).rows[0].jobs;
assert.ok(push.some(job=>job.payload.url==='/#herramental'));
await db.exec('reset role');
await db.exec('set role anon');
assert.equal((await portal({operation:'catalog'})).parts.length,seedPath?408:2);
const linked=await portal({operation:'submit',request_key:'00000000-0000-4000-8000-000000000003',order:{
 ...shared,folio:'TYPE-LINKED',np:'NP001-1',product:'Producto de prueba',
 production_type:'print',die_id:null,plates:'PLC-2',ink_selections:[{slot:1,product_id:inkLot.product_id}]
}});
assert.equal(linked.recipe_ready,true);
await db.exec('reset role');
await db.query("update public.prisma_orders set status='confirmed' where id=$1",[linked.id]);
await db.query("insert into public.prisma_items(order_id,lot_id,np,grams,cost_kg,meters) values($1,$2,'NP001-1',100,0,500),($1,$2,'NP001-1',150,0,500)",[linked.id,inkLot.id]);
await user(a);
assert.equal((await plant('forecast',{code:'NP001-1',meters:1000})).estimates[0].estimated_grams,500);
assert.equal((await plant('recipe',{order_id:linked.id})).recipe.stations[0].anilox,'AX1');
await db.exec('reset role;set role anon');
await assert.rejects(plant('tools'),/permission denied/);
console.log('Validado: preparación, clasificación, reservas, maestros de planta, reafile, avisos diarios y recetas por NP.');
await db.close();
