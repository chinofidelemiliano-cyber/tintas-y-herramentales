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
test('PDF seed retains 88 lots, 324741 grams and two historical negative balances',async()=>{assert.equal(state.lots.length,88);assert.equal(state.lots.reduce((s,l)=>s+l.grams,0),324741);assert.equal(state.lots.filter(l=>l.grams<0).length,2);const r=await fetch(base);assert.equal(r.status,200);assert.match(await r.text(),/Prisma/)});
test('income creates product and lot atomically, persists and can be consumed',async()=>{await post('movements',{type:'in',name:'Tinta piloto',code:'TEST-01',kind:'Base Agua',provider:'Pruebas',category:'tinta',lot:'LOTE-01',shelf_days:365,cost_kg:200,grams:1000,date:state.today,reason:'Compra de prueba'});const s=await get();const l=s.lots.find(l=>l.code==='TEST-01');assert.equal(l.grams,1000);assert.equal(s.products.filter(p=>p.code==='TEST-01').length,1);await post('movements',{type:'out',lot_id:l.id,grams:100,date:state.today,reason:'Muestra'});assert.equal((await get()).lots.find(x=>x.id===l.id).grams,900)});
test('orders aggregate duplicate lots, deduct once, cancel once, reject duplicate folios and overspending',async()=>{const s=await get(),l=s.lots.find(l=>l.code==='TEST-01');await post('orders',{folio:'OP-TEST',client:'Prueba',date:s.today,lines:[{lot_id:l.id,grams:100},{lot_id:l.id,grams:200}]});let current=await get();assert.equal(current.lots.find(x=>x.id===l.id).grams,600);const o=current.orders.find(o=>o.folio==='OP-TEST');assert.equal(o.lines.length,1);await post('orders',{folio:'OP-TEST',client:'Duplicada',date:s.today,lines:[{lot_id:l.id,grams:10}]},400);await post('orders',{folio:'OP-EXCESS',client:'Exceso',date:s.today,lines:[{lot_id:l.id,grams:100},{lot_id:l.id,grams:600}]},400);current=await get();assert.equal(current.lots.find(x=>x.id===l.id).grams,600);assert.equal(current.orders.some(o=>o.folio==='OP-EXCESS'),false);await post('orders/cancel',{id:o.id});assert.equal((await get()).lots.find(x=>x.id===l.id).grams,900);await post('orders/cancel',{id:o.id},400);assert.equal((await get()).lots.find(x=>x.id===l.id).grams,900)});
test('insufficient exits, invalid and future dates do not change inventory',async()=>{const s=await get(),l=s.lots.find(l=>l.code==='TEST-01');for(const b of [{grams:901,date:s.today},{grams:-1,date:s.today},{grams:1,date:'2026-02-31'},{grams:1,date:'2099-12-31'}])await post('movements',{type:'out',lot_id:l.id,reason:'Invalid',...b},400);assert.equal((await get()).lots.find(x=>x.id===l.id).grams,900)});
test('monthly close snapshots balances, blocks closed-period writes and preserves current stock',async()=>{
 const current=state.today.slice(0,7),prevDate=new Date(current+'-01T12:00:00Z');prevDate.setUTCMonth(prevDate.getUTCMonth()-1);const prev=prevDate.toISOString().slice(0,7),d=prev+'-01';
 fixture.prepare("UPDATE metadata SET value=? WHERE key='baseline'").run(d);fixture.prepare("UPDATE movements SET date=? WHERE type='initial'").run(d);
 const lot=(await get()).lots.find(l=>l.code==='TEST-01');await post('movements',{type:'in',lot_id:lot.id,grams:50,date:d,reason:'Mes anterior'});
 await post('cuts',{month:current},400);await post('cuts',{month:prev});const s=await get(),cut=s.cuts.find(c=>c.month===prev);assert.ok(cut);const row=cut.snapshot.find(r=>r.lot_id===lot.id);assert.equal(row.incoming,50);assert.equal(row.closing,50);assert.equal(s.lots.find(l=>l.id===lot.id).grams,950);
 await post('movements',{type:'in',lot_id:lot.id,grams:1,date:d,reason:'Cerrado'},400);await post('cuts',{month:prev},400);assert.equal((await get()).lots.find(l=>l.id===lot.id).grams,950);
});
