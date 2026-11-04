import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { canonicalCode } from './public/inventory-model.js';
import { preparationMinutes } from './public/preparation-model.js';
import {jpegPhoto,incidentSeconds} from './public/incident-photos.js';
import { incidentMachines,incidentOwners,incidentImpacts,incidentStatuses,incidentFolio } from './public/incident-model.js';

const root = path.dirname(fileURLToPath(import.meta.url));
mkdirSync(path.join(root, 'data'), { recursive: true });
const db = new DatabaseSync(process.env.DB_PATH || path.join(root, 'data/inventory.sqlite'));
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,kind TEXT NOT NULL,provider TEXT NOT NULL,category TEXT NOT NULL DEFAULT 'tinta',minimum REAL NOT NULL DEFAULT 1000);
CREATE TABLE IF NOT EXISTS lots(id INTEGER PRIMARY KEY,product_id INTEGER NOT NULL REFERENCES products(id),lot TEXT NOT NULL,entry_date TEXT NOT NULL,shelf_days INTEGER NOT NULL,cost_kg REAL NOT NULL,grams REAL NOT NULL,UNIQUE(product_id,lot));
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,folio TEXT NOT NULL UNIQUE,client TEXT NOT NULL,date TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'confirmed');
CREATE TABLE IF NOT EXISTS movements(id INTEGER PRIMARY KEY,lot_id INTEGER NOT NULL REFERENCES lots(id),type TEXT NOT NULL,grams REAL NOT NULL,cost_kg REAL NOT NULL,date TEXT NOT NULL,reason TEXT NOT NULL,order_id INTEGER REFERENCES orders(id));
CREATE TABLE IF NOT EXISTS cuts(id INTEGER PRIMARY KEY,month TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
db.exec(`CREATE TABLE IF NOT EXISTS preparations(id INTEGER PRIMARY KEY,date TEXT NOT NULL,folio TEXT NOT NULL,np TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,end_next_day INTEGER NOT NULL DEFAULT 0,minutes REAL NOT NULL,requested_date TEXT,requested_time TEXT,supplies TEXT NOT NULL,product TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '');`);
db.exec(`CREATE TABLE IF NOT EXISTS incidents(id INTEGER PRIMARY KEY,incident_number INTEGER NOT NULL UNIQUE,date TEXT NOT NULL,order_id INTEGER NOT NULL REFERENCES orders(id),order_ref TEXT NOT NULL,np TEXT NOT NULL DEFAULT '',machine TEXT NOT NULL,description TEXT NOT NULL,responsible TEXT NOT NULL,action TEXT NOT NULL DEFAULT '',impact TEXT NOT NULL,status TEXT NOT NULL,prepared_by TEXT NOT NULL DEFAULT '',color_observed TEXT NOT NULL DEFAULT '',test_result TEXT NOT NULL DEFAULT '',validation_notes TEXT NOT NULL DEFAULT '',request_key TEXT UNIQUE);`);
for(const [column,type] of Object.entries({timer_mode:'INTEGER NOT NULL DEFAULT 0',started_at:'TEXT',ended_at:'TEXT',before_photo:'TEXT',after_photo:'TEXT'}))if(!db.prepare('PRAGMA table_info(incidents)').all().some(c=>c.name===column))db.exec(`ALTER TABLE incidents ADD COLUMN ${column} ${type}`);
for (const [column, definition] of Object.entries({maximum:'REAL NOT NULL DEFAULT 0',shelf_days:'INTEGER NOT NULL DEFAULT 365',cost_kg:'REAL NOT NULL DEFAULT 0',container_grams:'REAL NOT NULL DEFAULT 4000'})) {
  if (!db.prepare('PRAGMA table_info(products)').all().some(c => c.name === column)) db.exec(`ALTER TABLE products ADD COLUMN ${column} ${definition}`);
}
const all = (q, ...p) => db.prepare(q).all(...p);
const one = (q, ...p) => db.prepare(q).get(...p);
const run = (q, ...p) => db.prepare(q).run(...p);
const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const fail = message => { throw new Error(message); };
const required = (v, label) => typeof v === 'string' && v.trim() ? v.trim() : fail(`Falta ${label}.`);
const number = (v, label, min = 0) => Number.isFinite(Number(v)) && Number(v) >= min ? Number(v) : fail(`${label}: cantidad no válida.`);
function date(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '') || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0,10)!==v) fail('Fecha no válida.');
  if(v > today()) fail('No se permiten movimientos con fecha futura.');
  if(v < one("SELECT value FROM metadata WHERE key='baseline'").value) fail('La fecha es anterior a la carga inicial.');
  if(one('SELECT id FROM cuts WHERE month>=? LIMIT 1', v.slice(0,7))) fail('El período está cerrado. Registra el ajuste en un mes abierto.');
  return v;
}
function tx(fn) { db.exec('BEGIN IMMEDIATE');try { const result=fn(); db.exec('COMMIT');return result; } catch(e) {db.exec('ROLLBACK');throw e;} }
if (!one("SELECT value FROM metadata WHERE key='seeded'")) tx(() => {
  for (const r of JSON.parse(readFileSync(path.join(root,'data/seed.json'),'utf8'))) {
    run('INSERT OR IGNORE INTO products(code,name,kind,provider) VALUES(?,?,?,?)',r.code,r.name,r.kind,r.provider);
    const p=one('SELECT id FROM products WHERE code=?',r.code);
    const l=run('INSERT INTO lots(product_id,lot,entry_date,shelf_days,cost_kg,grams) VALUES(?,?,?,?,?,?)',p.id,r.lot,r.entry_date,r.shelf_days,r.cost_kg,r.grams);
    run('INSERT INTO movements(lot_id,type,grams,cost_kg,date,reason) VALUES(?,?,?,?,?,?)',l.lastInsertRowid,'initial',r.grams,r.cost_kg,today(),'Carga inicial · inventario PDF');
  }
  run("INSERT INTO metadata VALUES('seeded','1')");run("INSERT INTO metadata VALUES('baseline',?)",today());
});
// Import once, retaining all lot balances, historical costs and movements.
if (!one("SELECT value FROM metadata WHERE key='catalog_v1'")) tx(() => {
  for (const old of all('SELECT * FROM products')) {
    const code = canonicalCode(old.code);
    if (old.code === code) continue;
    const target = one('SELECT * FROM products WHERE code=? AND id<>?', code, old.id);
    if (target) {
      for (const lot of all('SELECT * FROM lots WHERE product_id=?', old.id)) {
        if (one('SELECT id FROM lots WHERE product_id=? AND lot=?', target.id, lot.lot)) fail(`Revisa el lote duplicado ${lot.lot} antes de unificar ${code}.`);
        run('UPDATE lots SET product_id=? WHERE id=?', target.id, lot.id);
      }
      run('DELETE FROM products WHERE id=?', old.id);
    } else run('UPDATE products SET code=? WHERE id=?', code, old.id);
  }
  for (const p of JSON.parse(readFileSync(path.join(root,'public/catalog.json'),'utf8'))) {
    run(`INSERT INTO products(code,name,kind,provider,category,minimum,maximum,shelf_days,cost_kg,container_grams) VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name,kind=excluded.kind,provider=excluded.provider,minimum=excluded.minimum,maximum=excluded.maximum,shelf_days=excluded.shelf_days,cost_kg=excluded.cost_kg,container_grams=excluded.container_grams`,
      canonicalCode(p.code),p.name,p.kind,p.provider,p.category,p.minimum,p.maximum,p.shelf_days,p.cost_kg,p.container_grams);
  }
  run("INSERT INTO metadata VALUES('catalog_v1','1')");
});
// Authoritative stock count from the corrected PDF; apply once with an audit trail.
if(!one("SELECT value FROM metadata WHERE key='inventory_pdf_corrected_v1'"))tx(()=>{
 for(const r of JSON.parse(readFileSync(path.join(root,'data/inventory-corrected.json'),'utf8'))){
  const l=one('SELECT l.* FROM lots l JOIN products p ON p.id=l.product_id WHERE p.code=? AND l.lot=?',canonicalCode(r.code),r.lot);
  if(!l)fail('No se encontró el lote '+r.lot+' para actualizar el inventario.');
  const difference=r.grams-l.grams;
  if(Math.abs(difference)>0.000001){run('UPDATE lots SET grams=?,cost_kg=? WHERE id=?',r.grams,r.cost_kg,l.id);run('INSERT INTO movements(lot_id,type,grams,cost_kg,date,reason) VALUES(?,?,?,?,?,?)',l.id,difference>0?'in':'out',Math.abs(difference),r.cost_kg,today(),'Actualización de existencias · PDF invee.pdf');}
  else run('UPDATE lots SET cost_kg=? WHERE id=?',r.cost_kg,l.id);
 }
 run("INSERT INTO metadata VALUES('inventory_pdf_corrected_v1','1')");
});
// Preserve existing orders and movement references while allowing repeat production runs.
if (!one("SELECT value FROM metadata WHERE key='order_weighing_v1'")) {
 db.exec('PRAGMA foreign_keys=OFF');
 try {tx(()=>{
  db.exec(`CREATE TABLE orders_v2(id INTEGER PRIMARY KEY,folio TEXT NOT NULL,client TEXT NOT NULL,date TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'confirmed',pressman TEXT NOT NULL DEFAULT '',product TEXT NOT NULL DEFAULT '');
    INSERT INTO orders_v2(id,folio,client,date,notes,status) SELECT id,folio,client,date,notes,status FROM orders;
    DROP TABLE orders; ALTER TABLE orders_v2 RENAME TO orders;
    CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id),lot_id INTEGER NOT NULL REFERENCES lots(id),np TEXT NOT NULL DEFAULT '',initial_grams REAL,final_grams REAL,grams REAL NOT NULL,cost_kg REAL NOT NULL,meters REAL,notes TEXT NOT NULL DEFAULT '');
    INSERT INTO order_items(order_id,lot_id,grams,cost_kg) SELECT order_id,lot_id,grams,cost_kg FROM movements WHERE order_id IS NOT NULL AND type='out';`);
  if(all('PRAGMA foreign_key_check').length) fail('No se pudo conservar la relación de las órdenes.');
  run("INSERT INTO metadata VALUES('order_weighing_v1','1')");
 });}finally{db.exec('PRAGMA foreign_keys=ON');}
}
function state() {
  return {incidents:all('SELECT * FROM incidents ORDER BY incident_number DESC').map(({before_photo,after_photo,...i})=>({...i,has_before:!!before_photo,has_after:!!after_photo,elapsed_seconds:incidentSeconds(i),folio:incidentFolio(i.incident_number)})),preparations:all('SELECT * FROM preparations ORDER BY date DESC,start_time DESC,id DESC'),today:today(),baseline:one("SELECT value FROM metadata WHERE key='baseline'").value,
    products:all('SELECT * FROM products ORDER BY name'),
    lots:all('SELECT l.*,p.name,p.code,p.kind,p.provider,p.category,p.minimum,p.maximum,p.container_grams FROM lots l JOIN products p ON p.id=l.product_id ORDER BY p.name,l.entry_date'),
    movements:all('SELECT m.*,p.name,p.code,l.lot FROM movements m JOIN lots l ON m.lot_id=l.id JOIN products p ON p.id=l.product_id ORDER BY m.date DESC,m.id DESC'),
    orders:all('SELECT * FROM orders ORDER BY date DESC,id DESC').map(o=>({...o,lines:all('SELECT i.*,p.name,p.code,l.lot FROM order_items i JOIN lots l ON i.lot_id=l.id JOIN products p ON l.product_id=p.id WHERE order_id=? ORDER BY i.id',o.id)})),
    cuts:all('SELECT * FROM cuts ORDER BY month DESC').map(c=>({...c,snapshot:JSON.parse(c.snapshot)}))};
}
function startIncident(b){
 const old=b.request_key?one('SELECT * FROM incidents WHERE request_key=?',String(b.request_key)):null;
 if(old){if(old.order_id!==Number(b.order_id))fail('Esta captura ya está vinculada a otra orden.');return {id:old.id,folio:incidentFolio(old.incident_number),started_at:old.started_at};}
 const o=one('SELECT * FROM orders WHERE id=?',Number(b.order_id));if(!o)fail('Selecciona una orden registrada.');
 const n=one('SELECT coalesce(max(incident_number),10)+1 AS n FROM incidents').n,started=new Date().toISOString();
 const nps=all("SELECT DISTINCT np FROM order_items WHERE order_id=? AND np<>''",o.id),np=nps.length===1?nps[0].np:'';
 const result=run("INSERT INTO incidents(incident_number,date,order_id,order_ref,np,machine,description,responsible,impact,status,request_key,timer_mode,started_at) VALUES(?,?,?,?,?,'','Registro en curso','','','Abierta',?,1,?)",n,today(),o.id,o.folio,np,b.request_key?String(b.request_key):null,started);
 return {id:Number(result.lastInsertRowid),folio:incidentFolio(n),started_at:started};
}
function saveTimedIncident(b,old){
 if(Number(b.order_id)!==old.order_id)fail('La orden del cronómetro no se puede cambiar.');
 const finish=b.finish===true||!!old.ended_at;
 const merged={...old,...b};for(const key of ['before_photo','after_photo']){merged[key]=Object.hasOwn(b,key)?b[key]:old[key];if(merged[key])jpegPhoto(merged[key]);}
 if(finish&&(!merged.before_photo||!merged.after_photo))fail('Agrega la foto del defecto y la foto final para generar el formato.');
 for(const [key,allowed] of [['machine',incidentMachines],['responsible',incidentOwners],['impact',incidentImpacts]])if(merged[key]&&!allowed.includes(merged[key]))fail('Opción no válida para '+key+'.');
 const np=String(merged.np||'');if(np&&!one('SELECT id FROM order_items WHERE order_id=? AND np=?',old.order_id,np))fail('El NP no pertenece a esa orden.');
 const ended=old.ended_at||(finish?new Date().toISOString():null);
 run('UPDATE incidents SET np=?,machine=?,description=?,responsible=?,action=?,impact=?,status=?,prepared_by=?,color_observed=?,test_result=?,validation_notes=?,before_photo=?,after_photo=?,ended_at=? WHERE id=?',np,String(merged.machine||''),String(merged.description||'Defecto documentado en fotografía inicial.'),String(merged.responsible||''),String(merged.action||(finish?'Corrección documentada en fotografía final.':'')),String(merged.impact||''),finish?'Cerrada':'Abierta',String(merged.prepared_by||''),String(merged.color_observed||''),String(merged.test_result||''),String(merged.validation_notes||''),merged.before_photo||null,merged.after_photo||null,ended,old.id);
 return {id:old.id,folio:incidentFolio(old.incident_number),started_at:old.started_at,ended_at:ended};
}
function saveIncident(b){
 if(b.id){const current=one('SELECT * FROM incidents WHERE id=?',Number(b.id));if(current?.timer_mode)return saveTimedIncident(b,current);}
 if(b.request_key&&!b.id){const old=one('SELECT * FROM incidents WHERE request_key=?',String(b.request_key));if(old)return {id:old.id,folio:incidentFolio(old.incident_number)};}
 const d=b.date;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(d||'')||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d||d>today())fail('Fecha de incidencia no válida.');
 const o=one('SELECT * FROM orders WHERE id=?',Number(b.order_id));if(!o)fail('Selecciona una orden de producción registrada.');
 const np=String(b.np||'');if(np&&!one('SELECT id FROM order_items WHERE order_id=? AND np=?',o.id,np))fail('El NP no pertenece a esa orden.');
 for(const [key,allowed] of [['machine',incidentMachines],['responsible',incidentOwners],['impact',incidentImpacts],['status',incidentStatuses]])if(!allowed.includes(b[key]))fail('Selecciona una opción válida para '+key+'.');
 const description=required(b.description,'la descripción de la incidencia'),action=String(b.action||'');if(b.status==='Cerrada'&&!action.trim())fail('Captura la acción realizada antes de cerrar la incidencia.');
 const values=[d,o.id,o.folio,np,b.machine,description,b.responsible,action,b.impact,b.status,String(b.prepared_by||''),String(b.color_observed||''),String(b.test_result||''),String(b.validation_notes||'')];
 let row;
 if(b.id){row=one('SELECT * FROM incidents WHERE id=?',Number(b.id));if(!row)fail('Incidencia no encontrada.');run('UPDATE incidents SET date=?,order_id=?,order_ref=?,np=?,machine=?,description=?,responsible=?,action=?,impact=?,status=?,prepared_by=?,color_observed=?,test_result=?,validation_notes=? WHERE id=?',...values,row.id);}
 else{const n=one('SELECT coalesce(max(incident_number),10)+1 AS n FROM incidents').n;const result=run('INSERT INTO incidents(incident_number,date,order_id,order_ref,np,machine,description,responsible,action,impact,status,prepared_by,color_observed,test_result,validation_notes,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',n,...values,b.request_key?String(b.request_key):null);row={id:Number(result.lastInsertRowid),incident_number:n};}
 return {id:row.id,folio:incidentFolio(row.incident_number)};
}
function savePreparation(b){
 const validDate=value=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail('Fecha no válida.');
  return value;
 };
 const d=validDate(b.date);if(d>today())fail('No se permiten registros de preparación con fecha futura.');
 const next=b.end_next_day===true||b.end_next_day===1||b.end_next_day==='true';
 const minutes=preparationMinutes(b.start_time,b.end_time,next);
 const requested=b.requested_date?validDate(b.requested_date):null;
 if(b.requested_time)preparationMinutes(b.requested_time,b.requested_time);
 const values=[d,required(b.folio,'la orden'),required(b.np,'el NP'),b.start_time,b.end_time,next?1:0,minutes,requested,b.requested_time||null,required(b.supplies,'los insumos / herramentales'),required(b.product,'el producto'),String(b.notes||'')];
 if(b.id){if(!one('SELECT id FROM preparations WHERE id=?',b.id))fail('Registro de preparación no encontrado.');run('UPDATE preparations SET date=?,folio=?,np=?,start_time=?,end_time=?,end_next_day=?,minutes=?,requested_date=?,requested_time=?,supplies=?,product=?,notes=? WHERE id=?',...values,b.id);}
 else run('INSERT INTO preparations(date,folio,np,start_time,end_time,end_next_day,minutes,requested_date,requested_time,supplies,product,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',...values);
}
function product(b) {
  const code=canonicalCode(required(b.code,'el código'));
  const existing=one('SELECT * FROM products WHERE code=?',code);
  if(existing) return existing;
  const category=b.category==='herramental'?'herramental':'tinta';
  run('INSERT INTO products(code,name,kind,provider,category,minimum) VALUES(?,?,?,?,?,?)',code,required(b.name,'el nombre'),required(b.kind,'el tipo'),required(b.provider,'el proveedor'),category,number(b.minimum??(category==='tinta'?1000:1),'Mínimo'));
  return one('SELECT * FROM products WHERE code=?',code);
}
function move(b) {
  const d=date(b.date),grams=number(b.grams,'Cantidad',0.001),reason=required(b.reason,'el motivo');
  let l;
  if(b.type==='in') {
    if(b.lot_id) l=one('SELECT * FROM lots WHERE id=?',b.lot_id);
    else {
      const p=b.product_id?one('SELECT * FROM products WHERE id=?',b.product_id):product(b);
      if(!p) fail('Producto no encontrado.');
      const lot=required(b.lot,'el lote');
      l=one('SELECT * FROM lots WHERE product_id=? AND lot=?',p.id,lot);
      if(!l) {
        const id=run('INSERT INTO lots(product_id,lot,entry_date,shelf_days,cost_kg,grams) VALUES(?,?,?,?,?,0)',p.id,lot,d,number(b.shelf_days??p.shelf_days,'Caducidad'),number(b.cost_kg??p.cost_kg,'Costo')).lastInsertRowid;
        l=one('SELECT * FROM lots WHERE id=?',id);
      }
    }
  } else if(b.type==='out') l=one('SELECT * FROM lots WHERE id=?',b.lot_id);
  else fail('Tipo de movimiento no válido.');
  if(!l) fail('Lote no encontrado.');
  if(b.type==='out' && l.grams<grams) fail('Existencia insuficiente en este lote.');
  run('UPDATE lots SET grams=grams+? WHERE id=?',b.type==='in'?grams:-grams,l.id);
  run('INSERT INTO movements(lot_id,type,grams,cost_kg,date,reason) VALUES(?,?,?,?,?,?)',l.id,b.type,grams,l.cost_kg,d,reason);
}
function createOrder(b, existingId=null) {
  const existing=existingId?one('SELECT * FROM orders WHERE id=?',existingId):null;
  if(existingId && (!existing||existing.status!=='draft')) fail('Solo puedes editar registros pendientes.');
  if(existing) date(existing.date);
  const d=date(b.date),folio=required(b.folio,'la orden'),weighing=b.capture_mode==='weighing',draft=weighing&&b.status==='draft';
  const product=String(b.product||'').trim(),pressman=String(b.pressman||'').trim(),client=weighing?String(b.client||product).trim():required(b.client,'el cliente');
  if(weighing){required(product,'el producto');required(pressman,'el prensista');}
  const peers=all("SELECT * FROM orders WHERE folio=? AND status<>'cancelled' AND id<>?",folio,existingId||0);
  if(!weighing&&peers.length)fail('Ya existe una orden con ese folio.');
  if(!Array.isArray(b.lines)||!b.lines.length) fail('Agrega al menos una tinta.');
  const items=[],grouped=new Map();
  for(const line of b.lines){
    const l=one('SELECT l.*,p.category FROM lots l JOIN products p ON p.id=l.product_id WHERE l.id=?',Number(line.lot_id));
    if(!l||l.category!=='tinta')fail('Selecciona un lote de tinta.');
    let initial=null,final=null,grams,np=String(line.np||'').trim();
    if(weighing){
      required(np,'el NP de cada renglón');
      if(line.initial_grams===''||line.initial_grams==null)fail('Captura el peso inicial.');
      initial=number(line.initial_grams,'Ingreso / peso inicial');
      if(line.final_grams!==''&&line.final_grams!=null)final=number(line.final_grams,'Egreso / peso final');
      if(final===null&&!draft)fail('Falta el peso final. Guarda como pendiente o completa los pesos.');
      if(final!==null&&final>initial)fail('El peso final no puede superar al inicial. Registra una devolución o ajuste por separado.');
      grams=final===null?0:Math.round((initial-final)*1000)/1000;
    }else grams=number(line.grams,'Gramos',0.001);
    const meters=line.meters===''||line.meters==null?null:number(line.meters,'Metros');
    items.push({lot_id:l.id,np,initial,final,grams,cost_kg:l.cost_kg,meters,notes:String(line.notes||'')});
    grouped.set(l.id,(grouped.get(l.id)||0)+grams);
  }
  if(weighing&&peers.some(o=>o.date===d&&all('SELECT np FROM order_items WHERE order_id=?',o.id).some(i=>items.some(x=>x.np===i.np))))fail('Ya hay un registro de esta orden, fecha y NP. Revisa el registro existente.');
  if(!draft)for(const [id,grams] of grouped){const l=one('SELECT * FROM lots WHERE id=?',id);if(grams>0&&l.grams<grams)fail(`Existencia insuficiente en el lote ${l.lot}.`);}
  const status=draft?'draft':'confirmed';
  let id=existingId;
  if(existing){run('UPDATE orders SET folio=?,client=?,date=?,notes=?,status=?,pressman=?,product=? WHERE id=?',folio,client,d,String(b.notes||''),status,pressman,product,id);run('DELETE FROM order_items WHERE order_id=?',id);}
  else id=Number(run('INSERT INTO orders(folio,client,date,notes,status,pressman,product) VALUES(?,?,?,?,?,?,?)',folio,client,d,String(b.notes||''),status,pressman,product).lastInsertRowid);
  if(weighing)for(const i of items)run('INSERT INTO order_items(order_id,lot_id,np,initial_grams,final_grams,grams,cost_kg,meters,notes) VALUES(?,?,?,?,?,?,?,?,?)',id,i.lot_id,i.np,i.initial,i.final,i.grams,i.cost_kg,i.meters,i.notes);
  else for(const [lotId,grams] of grouped){const l=one('SELECT * FROM lots WHERE id=?',lotId);run('INSERT INTO order_items(order_id,lot_id,grams,cost_kg) VALUES(?,?,?,?)',id,lotId,grams,l.cost_kg);}
  if(!draft)for(const [lotId,grams] of grouped){
    if(grams===0)continue;
    const l=one('SELECT * FROM lots WHERE id=?',lotId);
    run('UPDATE lots SET grams=grams-? WHERE id=?',grams,lotId);
    run('INSERT INTO movements(lot_id,type,grams,cost_kg,date,reason,order_id) VALUES(?,?,?,?,?,?,?)',lotId,'out',grams,l.cost_kg,d,`Orden ${folio}`,id);
  }
}
function updateOrder(b){createOrder(b,Number(b.id));}

function cancelOrder(b) {
  const o=one('SELECT * FROM orders WHERE id=?',b.id);
  if(!o) fail('Orden no encontrada.');
  if(o.status==='cancelled') fail('La orden ya está cancelada.');
  date(o.date); const d=date(today());
  for(const m of all("SELECT * FROM movements WHERE order_id=? AND type='out'",o.id)) {
    run('UPDATE lots SET grams=grams+? WHERE id=?',m.grams,m.lot_id);
    run('INSERT INTO movements(lot_id,type,grams,cost_kg,date,reason,order_id) VALUES(?,?,?,?,?,?,?)',m.lot_id,'in',m.grams,m.cost_kg,d,`Cancelación ${o.folio}`,o.id);
  }
  run("UPDATE orders SET status='cancelled' WHERE id=?",o.id);
}
function closeMonth(b) {
  const month=required(b.month,'el mes');
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail('Mes no válido.');
  if(month>=today().slice(0,7)) fail('El corte definitivo se realiza después de terminar el mes. Puedes consultar el resumen actual.');
  if(month<one("SELECT value FROM metadata WHERE key='baseline'").value.slice(0,7)) fail('No hay historia registrada para ese mes.');
  if(one('SELECT id FROM cuts WHERE month=?',month)) fail('Ese mes ya tiene un corte.');
  if(one("SELECT id FROM orders WHERE status='draft' AND substr(date,1,7)<=? LIMIT 1",month))fail('Completa o cancela los registros pendientes antes de cerrar el mes.');
  const rows=all('SELECT l.*,p.name,p.code,p.category FROM lots l JOIN products p ON p.id=l.product_id').map(l=>{
    const ms=all('SELECT * FROM movements WHERE lot_id=? AND date<?',l.id,month+'-32');
    let opening=0,incoming=0,outgoing=0;
    for(const m of ms) {
      if(m.date.slice(0,7)<month || (m.type==='initial'&&m.date.slice(0,7)===month)) opening+=m.type==='out'?-m.grams:m.grams;
      else if(m.type==='in') incoming+=m.grams;else if(m.type==='out') outgoing+=m.grams;
    }
    return {lot_id:l.id,name:l.name,code:l.code,lot:l.lot,category:l.category,opening,incoming,outgoing,closing:opening+incoming-outgoing,cost_kg:l.cost_kg};
  });
  run('INSERT INTO cuts(month,created_at,snapshot) VALUES(?,?,?)',month,new Date().toISOString(),JSON.stringify(rows));
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  try {
    if(url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
      if(req.method==='GET'&&/^\/api\/incidents\/\d+\/evidence$/.test(url.pathname)){const row=one('SELECT id,before_photo,after_photo FROM incidents WHERE id=?',Number(url.pathname.split('/')[3]));if(!row)fail('Incidencia no encontrada.');return res.end(JSON.stringify(row));}
      if(req.method==='GET' && url.pathname==='/api/state') return res.end(JSON.stringify(state()));
      if(req.method!=='POST') {res.statusCode=404;return res.end(JSON.stringify({error:'Ruta no encontrada.'}));}
      if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}` && req.headers.origin!==`https://${req.headers.host}`) fail('Origen no permitido.');
      let raw='';for await(const chunk of req) {raw+=chunk;if(raw.length>1000000) fail('Solicitud demasiado grande.');}
      const b=JSON.parse(raw||'{}');
      const actions={'/api/incidents/start':startIncident,'/api/incidents':saveIncident,'/api/preparations':savePreparation,'/api/movements':move,'/api/products':product,'/api/orders':createOrder,'/api/orders/update':updateOrder,'/api/orders/cancel':cancelOrder,'/api/cuts':closeMonth};
      if(!actions[url.pathname]) fail('Ruta no encontrada.');
      const result=tx(()=>actions[url.pathname](b));res.end(JSON.stringify({ok:true,...(result||{})}));return;
    }
    if(req.method!=='GET') {res.writeHead(405);res.end();return;}
    const file=path.join(root,'public',url.pathname==='/'?'index.html':url.pathname);
    if(!file.startsWith(path.join(root,'public')+path.sep)||!existsSync(file)) {res.writeHead(404);res.end('No encontrado');return;}
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
    res.setHeader('X-Content-Type-Options','nosniff');res.end(readFileSync(file));
  } catch(e) {res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:e.message}));}
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log(`Inventario listo en puerto ${process.env.PORT||3000}`));
