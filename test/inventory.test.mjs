import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const dir=mkdtempSync(path.join(os.tmpdir(),'prisma-test-'));
const port=14000+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`;
let server,state,fixture;
const get=async()=>{const r=await fetch(base+'/api/state');assert.equal(r.status,200);return r.json()};
const post=async(route,b,expected=200)=>{const r=await fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const d=await r.json();assert.equal(r.status,expected,JSON.stringify(d));return d};
before(async()=>{
 server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),DB_PATH:path.join(dir,'test.sqlite')},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{let ready=false;const timer=setTimeout(()=>reject(Error('Server startup timeout')),10000);server.stdout.on('data',d=>{if(String(d).includes('Inventario listo')){ready=true;clearTimeout(timer);resolve()}});server.on('exit',code=>{if(!ready){clearTimeout(timer);reject(Error('Server exited: '+code))}})});
 state=await get();fixture=new DatabaseSync(path.join(dir,'test.sqlite'));
});
after(async()=>{fixture?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r))}rmSync(dir,{recursive:true,force:true})});
test('PDF seed retains 88 lots, 342813 grams and no negative balances',async()=>{assert.equal(state.lots.length,88);assert.equal(state.lots.reduce((s,l)=>s+l.grams,0),342813);assert.equal(state.lots.filter(l=>l.grams<0).length,0);const r=await fetch(base);assert.equal(r.status,200);assert.match(await r.text(),/<main id="main">/)});
test('income creates product and lot atomically, persists and can be consumed',async()=>{await post('movements',{type:'in',name:'Tinta piloto',code:'TEST-01',kind:'Base Agua',provider:'Pruebas',category:'tinta',lot:'LOTE-01',shelf_days:365,cost_kg:200,grams:1000,date:state.today,reason:'Compra de prueba'});const s=await get();const l=s.lots.find(l=>l.code==='TEST-01');assert.equal(l.grams,1000);assert.equal(s.products.filter(p=>p.code==='TEST-01').length,1);await post('movements',{type:'out',lot_id:l.id,grams:100,date:state.today,reason:'Muestra'});assert.equal((await get()).lots.find(x=>x.id===l.id).grams,900)});
test('orders aggregate duplicate lots, deduct once, cancel once, reject duplicate folios and overspending',async()=>{const s=await get(),l=s.lots.find(l=>l.code==='TEST-01');await post('orders',{folio:'OP-TEST',client:'Prueba',date:s.today,lines:[{lot_id:l.id,grams:100},{lot_id:l.id,grams:200}]});let current=await get();assert.equal(current.lots.find(x=>x.id===l.id).grams,600);const o=current.orders.find(o=>o.folio==='OP-TEST');assert.equal(o.lines.length,1);await post('orders',{folio:'OP-TEST',client:'Duplicada',date:s.today,lines:[{lot_id:l.id,grams:10}]},400);await post('orders',{folio:'OP-EXCESS',client:'Exceso',date:s.today,lines:[{lot_id:l.id,grams:100},{lot_id:l.id,grams:600}]},400);current=await get();assert.equal(current.lots.find(x=>x.id===l.id).grams,600);assert.equal(current.orders.some(o=>o.folio==='OP-EXCESS'),false);await post('orders/cancel',{id:o.id});assert.equal((await get()).lots.find(x=>x.id===l.id).grams,900);await post('orders/cancel',{id:o.id},400);assert.equal((await get()).lots.find(x=>x.id===l.id).grams,900)});
test('insufficient exits, invalid and future dates do not change inventory',async()=>{const s=await get(),l=s.lots.find(l=>l.code==='TEST-01');for(const b of [{grams:901,date:s.today},{grams:-1,date:s.today},{grams:1,date:'2026-02-31'},{grams:1,date:'2099-12-31'}])await post('movements',{type:'out',lot_id:l.id,reason:'Invalid',...b},400);assert.equal((await get()).lots.find(x=>x.id===l.id).grams,900)});
test('monthly close snapshots balances, blocks closed-period writes and preserves current stock',async()=>{
 const current=state.today.slice(0,7),prevDate=new Date(current+'-01T12:00:00Z');prevDate.setUTCMonth(prevDate.getUTCMonth()-1);const prev=prevDate.toISOString().slice(0,7),d=prev+'-01';
 fixture.prepare("UPDATE metadata SET value=? WHERE key='baseline'").run(d);fixture.prepare("UPDATE movements SET date=? WHERE type='initial'").run(d);
 const lot=(await get()).lots.find(l=>l.code==='TEST-01');await post('movements',{type:'in',lot_id:lot.id,grams:50,date:d,reason:'Mes anterior'});
 const pending={capture_mode:'weighing',status:'draft',folio:'OP-BLOCK-CLOSE',product:'Pendiente',pressman:'Julio',date:d,lines:[{lot_id:lot.id,np:'CLOSE-1',initial_grams:10,final_grams:''}]};
 await post('orders',pending);await post('cuts',{month:prev},400);const pendingId=(await get()).orders.find(o=>o.folio==='OP-BLOCK-CLOSE').id;await post('orders/cancel',{id:pendingId});
 await post('cuts',{month:current},400);await post('cuts',{month:prev});const s=await get(),cut=s.cuts.find(c=>c.month===prev);assert.ok(cut);const row=cut.snapshot.find(r=>r.lot_id===lot.id);assert.equal(row.incoming,50);assert.equal(row.closing,50);assert.equal(s.lots.find(l=>l.id===lot.id).grams,950);
 await post('movements',{type:'in',lot_id:lot.id,grams:1,date:d,reason:'Cerrado'},400);await post('cuts',{month:prev},400);assert.equal((await get()).lots.find(l=>l.id===lot.id).grams,950);
});
test('catalog import matches codes without duplicating stock or changing historical lot costs',async()=>{
 assert.equal(state.products.length,75);
 const p=state.products.find(p=>p.code==='E3024P01');assert.equal(p.maximum,16000);assert.equal(p.minimum,4000);assert.equal(p.shelf_days,185);assert.equal(p.cost_kg,205);
 assert.equal(state.lots.find(l=>l.code==='APP50EP021ID').grams,3152);
 assert.equal(state.products.some(p=>p.code==='UIAPP50EP021ID'),false);
 assert.equal(state.products.filter(p=>p.code==='E3024P01').length,1);
 assert.equal(state.lots.filter(l=>l.code==='E3024P01').length,2);
 assert.equal(state.products.find(p=>p.code==='FLMRC-164').name,'Rojo Cera');
 assert.equal(state.lots.filter(l=>l.code==='FLMRC-164').length,0);
 assert.ok(Math.abs(state.lots.reduce((s,l)=>s+l.grams*l.cost_kg/1000,0)-101316.83)<0.01);
});
test('reference-style weighing deducts only initial minus final and stores production fields',async()=>{
 let s=await get();const lot=s.lots.find(l=>l.code==='TEST-01'),before=lot.grams;
 await post('orders',{capture_mode:'weighing',folio:'OP-WEIGH',product:'Producto prueba',pressman:'Manuel',date:s.today,lines:[{lot_id:lot.id,np:'281-1',initial_grams:3278,final_grams:3186,meters:1266,notes:'Referencia de pesaje'}]});
 s=await get();const o=s.orders.find(o=>o.folio==='OP-WEIGH');assert.equal(o.lines[0].grams,92);assert.equal(o.lines[0].initial_grams,3278);assert.equal(o.lines[0].final_grams,3186);assert.equal(o.lines[0].np,'281-1');assert.equal(o.lines[0].meters,1266);assert.equal(o.pressman,'Manuel');assert.equal(o.product,'Producto prueba');assert.equal(s.lots.find(l=>l.id===lot.id).grams,before-92);
 await post('orders/cancel',{id:o.id});assert.equal((await get()).lots.find(l=>l.id===lot.id).grams,before);
});
test('pending weights do not deduct stock and completing them deducts once',async()=>{
 let s=await get();const lot=s.lots.find(l=>l.code==='TEST-01'),before=lot.grams;
 const body={capture_mode:'weighing',folio:'OP-PENDING',product:'Don Finca',pressman:'Julio',date:s.today,status:'draft',lines:[{lot_id:lot.id,np:'118-1',initial_grams:2382,final_grams:''}]};
 await post('orders',body);s=await get();const o=s.orders.find(o=>o.folio==='OP-PENDING');assert.equal(o.status,'draft');assert.equal(o.lines[0].final_grams,null);assert.equal(s.lots.find(l=>l.id===lot.id).grams,before);
 await post('orders/update',{...body,id:o.id,status:'confirmed',lines:[{...body.lines[0],final_grams:2328}]});s=await get();assert.equal(s.orders.find(x=>x.id===o.id).status,'confirmed');assert.equal(s.lots.find(l=>l.id===lot.id).grams,before-54);
 await post('orders/update',{...body,id:o.id,status:'confirmed',lines:[{...body.lines[0],final_grams:2328}]},400);assert.equal((await get()).lots.find(l=>l.id===lot.id).grams,before-54);
});
test('repeated order numbers allow another NP but reject duplicate runs and invalid weights',async()=>{
 let s=await get();const lot=s.lots.find(l=>l.code==='TEST-01'),before=lot.grams;
 const body={capture_mode:'weighing',folio:'OP-PENDING',product:'Don Finca',pressman:'Julio',date:s.today,lines:[{lot_id:lot.id,np:'118-2',initial_grams:100,final_grams:90}]};
 await post('orders',body);await post('orders',body,400);
 for(const line of [{...body.lines[0],np:'BAD-1',final_grams:101},{...body.lines[0],np:'BAD-2',final_grams:''}])await post('orders',{...body,lines:[line]},400);
 assert.equal((await get()).lots.find(l=>l.id===lot.id).grams,before-10);
});
test('preparation log saves and edits time records without changing stock or movements',async()=>{
 const s=await get(),balance=s.lots.map(l=>[l.id,l.grams]),count=s.movements.length;
 const body={date:s.today,folio:'OP-PREP-1',np:'330-1',start_time:'06:58',end_time:'07:08',requested_date:s.today,requested_time:'07:30',supplies:'6 rasquetas, 6 charolas, 6 tintas y 1 suaje',product:'Producto piloto',notes:'Preparación sin consumos'};
 await post('preparations',body);let current=await get(),row=current.preparations.find(p=>p.folio===body.folio);assert.equal(row.minutes,10);assert.equal(row.requested_time,'07:30');
 await post('preparations',{...body,id:row.id,start_time:'23:50',end_time:'00:10',end_next_day:true});current=await get();assert.equal(current.preparations.find(p=>p.id===row.id).minutes,20);
 await post('preparations',{...body,start_time:'23:50',end_time:'00:10'},400);await post('preparations',{...body,start_time:'24:00'},400);
 assert.deepEqual(current.lots.map(l=>[l.id,l.grams]),balance);assert.equal(current.movements.length,count);assert.equal((await get()).preparations.length,current.preparations.length);
});
test('incidents start at INC-0011, link existing orders and preserve stock',async()=>{
 const s=await get(),o=s.orders.find(o=>o.folio==='OP-PENDING'&&o.status==='confirmed'),before=s.lots.map(l=>[l.id,l.grams]);
 const body={date:s.today,order_id:o.id,np:o.lines[0].np,machine:'Comco 2',responsible:'Producción',description:'Selección incorrecta de anilox',action:'',impact:'Paro',status:'Abierta',request_key:'incident-test-one'};
 const result=await post('incidents',body);assert.equal(result.folio,'INC-0011');const retry=await post('incidents',body);assert.equal(retry.id,result.id);
 let current=await get();assert.equal(current.incidents.length,1);assert.equal(current.incidents[0].order_ref,'OP-PENDING');
 const next=await post('incidents',{...body,request_key:'incident-test-two',machine:'Mark Andy'});assert.equal(next.folio,'INC-0012');
 await post('incidents',{...body,id:result.id,status:'Cerrada'},400);
 await post('incidents',{...body,id:result.id,status:'Cerrada',action:'Ajuste y verificación'});current=await get();assert.equal(current.incidents.find(i=>i.id===result.id).folio,'INC-0011');assert.equal(current.incidents.find(i=>i.id===result.id).status,'Cerrada');
 for(const change of [{order_id:999999},{np:'NP-AJENO'},{machine:'Desconocida'},{responsible:'Sin responsable'}])await post('incidents',{...body,request_key:'bad-'+JSON.stringify(change),...change},400);
 assert.deepEqual((await get()).lots.map(l=>[l.id,l.grams]),before);
});
test('timed incidents persist start, protect photo payloads and end only with both pictures',async()=>{
 const {readFileSync}=await import('node:fs');const photo='data:image/jpeg;base64,'+readFileSync(new URL('./fixtures/before.jpg',import.meta.url)).toString('base64');
 let s=await get();const order=s.orders.find(o=>o.folio==='OP-PENDING'&&o.status==='confirmed'),balance=s.lots.map(l=>[l.id,l.grams]);
 const started=await post('incidents/start',{order_id:order.id,request_key:'timed-test-first'});const repeat=await post('incidents/start',{order_id:order.id,request_key:'timed-test-first'});assert.equal(started.id,repeat.id);assert.equal(started.started_at,repeat.started_at);
 await post('incidents',{id:started.id,order_id:order.id,finish:true},400);
 await post('incidents',{id:started.id,order_id:order.id,before_photo:photo,finish:false});s=await get();let row=s.incidents.find(i=>i.id===started.id);assert.ok(row.has_before);assert.equal(row.ended_at,null);assert.equal(Object.hasOwn(row,'before_photo'),false);
 await post('incidents',{id:started.id,order_id:order.id,after_photo:'data:image/svg+xml;base64,AAAA',finish:true},400);
 await post('incidents',{id:started.id,order_id:order.id,after_photo:photo,finish:true});s=await get();row=s.incidents.find(i=>i.id===started.id);assert.equal(row.status,'Cerrada');assert.ok(row.ended_at);assert.ok(row.has_after);
 const evidence=await(await fetch(base+'/api/incidents/'+row.id+'/evidence')).json();assert.equal(evidence.before_photo,photo);assert.equal(evidence.after_photo,photo);
 await post('incidents',{id:row.id,order_id:order.id,description:'Detalle actualizado',finish:true});assert.equal((await get()).incidents.find(i=>i.id===row.id).ended_at,row.ended_at);assert.deepEqual((await get()).lots.map(l=>[l.id,l.grams]),balance);
});
test('production clock is persistent and idempotent, Teams imports drafts without inventory access or duplicate orders',async()=>{
 const {readFileSync}=await import('node:fs');const html=readFileSync(new URL('./fixtures/teams-order.html',import.meta.url),'utf8');
 const before=await get(),stock=before.lots.map(l=>[l.id,l.grams]),moveCount=before.movements.length;
 const connection=await post('teams/connection',{operation:'configure',conversation_id:'chat-test'});assert.match(connection.token,/^tt_[a-f0-9]{64}$/);
 const receive=async(body,token=connection.token,expected=200)=>{const r=await fetch(base+'/api/teams-orders',{method:'POST',headers:{'Content-Type':'application/json','X-Integration-Key':token},body:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));return data;};
 const body={conversation_id:'chat-test',message_id:'message-1',html};
 await receive(body,'tt_'+'0'.repeat(64),400);await receive({...body,conversation_id:'wrong'},connection.token,400);
 const imported=await receive(body),id=imported.order_ids[0];assert.ok(id);assert.equal((await receive(body)).duplicate,true);
 assert.deepEqual((await receive({...body,message_id:'forwarded-message'})).order_ids,[id]);await receive({...body,message_id:'conflicting-message',html:html.replace('12,725','12,726')},connection.token,400);
 const fresh=await get(),order=fresh.orders.find(o=>o.id===id);assert.equal(order.lines.length,0);assert.equal(order.status,'draft');assert.equal(order.planned_meters,12725);assert.equal(order.np,'NP016-1');assert.equal(order.source,'teams');assert.equal(order.scheduled_start,'07:40');assert.equal(fresh.orders.filter(o=>o.source==='teams').length,1);assert.deepEqual(fresh.lots.map(l=>[l.id,l.grams]),stock);assert.equal(fresh.movements.length,moveCount);assert.equal(JSON.stringify(fresh).includes(connection.token),false);
 await post('orders/clock',{id,operation:'finish'},400);
 const start=await post('orders/clock',{id,operation:'start'});assert.ok(start.started_at);assert.equal((await post('orders/clock',{id,operation:'start'})).started_at,start.started_at);
 await new Promise(r=>setTimeout(r,30));const end=await post('orders/clock',{id,operation:'finish'});assert.ok(Date.parse(end.ended_at)>=Date.parse(start.started_at));assert.equal((await post('orders/clock',{id,operation:'finish'})).ended_at,end.ended_at);await post('orders/clock',{id,operation:'start'},400);
 // Completing weights preserves timing and consumes only the measured difference.
 const lot=(await get()).lots.find(l=>l.grams>100);await post('orders/update',{id,capture_mode:'weighing',status:'confirmed',folio:order.folio,product:order.product,client:order.client,pressman:'Prueba',date:order.date,lines:[{lot_id:lot.id,np:order.np,initial_grams:100,final_grams:90}]});const completed=(await get()).orders.find(o=>o.id===id);assert.equal(completed.started_at,start.started_at);assert.equal(completed.ended_at,end.ended_at);assert.equal((await get()).lots.find(l=>l.id===lot.id).grams,lot.grams-10);
 const rotated=await post('teams/connection',{operation:'configure',conversation_id:'chat-test'});await receive({...body,message_id:'message-2'},connection.token,400);await post('teams/connection',{operation:'disable'});await receive({...body,message_id:'message-2'},rotated.token,400);
});
