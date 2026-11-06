import {normalizeProductionPlan,productionAction,syncMachineIncidents,publicProduction,privateProduction,dailyProductionAudit} from './public/production-session-model.js';
import {pressSheetSnapshot,normalizePressFields,plannedBobinas,completeBobina,stageFields} from './public/press-sheet-model.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {validTimeZone,todayInZone,normalizeTimeSettings,effectiveTimeZone} from './public/time.js';
import {orderMonth,publicOrderStatus} from './public/order-status-model.js';
import {normalizeInkOptions,resolveOrderInks,inkFamily,orderInkSummary} from './public/order-ink-options.js';
import http from 'node:http';
import {decimalDifference,decimalSum} from './public/quantity.js';
import {mixtureRecipe} from './public/pantone-model.js';
import {normalizePortalOrder} from './public/order-portal-model.js';
import {randomBytes,createHash,scryptSync,timingSafeEqual} from 'node:crypto';
import {parseTeamsOrders} from './netlify/lib/teams-parser.mjs';
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
const requestTime=new AsyncLocalStorage();const sharedTime=()=>{try{return normalizeTimeSettings(JSON.parse(one("SELECT value FROM metadata WHERE key='site_time_settings'")?.value||'{}'));}catch{return normalizeTimeSettings();}};
const today=()=>todayInZone({timezoneMode:'custom',timeZone:requestTime.getStore()?.timeZone||sharedTime().timeZone});
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
for(const [column,type] of Object.entries({started_at:'TEXT',ended_at:'TEXT',np:"TEXT NOT NULL DEFAULT ''",source:"TEXT NOT NULL DEFAULT 'manual'",received_at:'TEXT',scheduled_date:'TEXT',scheduled_start:'TEXT',scheduled_end:'TEXT',pieces:'REAL',planned_meters:'REAL',specifications:"TEXT NOT NULL DEFAULT '{}'"}))if(!all('PRAGMA table_info(orders)').some(c=>c.name===column))db.exec(`ALTER TABLE orders ADD COLUMN ${column} ${type}`);
db.exec(`CREATE TABLE IF NOT EXISTS teams_connection(id INTEGER PRIMARY KEY,conversation_id TEXT NOT NULL,token_hash TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);CREATE TABLE IF NOT EXISTS teams_receipts(conversation_id TEXT NOT NULL,message_id TEXT NOT NULL,order_ids TEXT NOT NULL,PRIMARY KEY(conversation_id,message_id));`);
for(const [column,type] of Object.entries({machine:"TEXT NOT NULL DEFAULT ''",queue_number:'INTEGER'}))if(!all('PRAGMA table_info(orders)').some(c=>c.name===column))db.exec(`ALTER TABLE orders ADD COLUMN ${column} ${type}`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS order_queue_number ON orders(queue_number) WHERE queue_number IS NOT NULL;CREATE TABLE IF NOT EXISTS order_portal_access(id INTEGER PRIMARY KEY,token_hash TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);CREATE TABLE IF NOT EXISTS order_portal_submissions(request_key TEXT PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id),payload_hash TEXT NOT NULL);`);
if(!all('PRAGMA table_info(products)').some(c=>c.name==='tool_type'))db.exec("ALTER TABLE products ADD COLUMN tool_type TEXT NOT NULL DEFAULT ''");
if(!all('PRAGMA table_info(products)').some(c=>c.name==='tooling_details'))db.exec("ALTER TABLE products ADD COLUMN tooling_details TEXT NOT NULL DEFAULT '{}'");
if(!one("SELECT value FROM metadata WHERE key='tooling_pdf_20261104_v1'"))tx(()=>{
 for(const item of JSON.parse(readFileSync(path.join(root,'data/tooling-inventory.json'),'utf8'))){
  const existing=one('SELECT * FROM products WHERE code=?',item.code);if(existing&&existing.category!=='herramental')fail('Código de herramental en conflicto: '+item.code);
  run("INSERT INTO products(code,name,kind,provider,category,minimum,maximum,shelf_days,cost_kg,container_grams,tool_type,tooling_details) VALUES(?,?,?,?,'herramental',0,0,0,?,1,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name,kind=excluded.kind,provider=excluded.provider,cost_kg=excluded.cost_kg,tool_type=excluded.tool_type,tooling_details=excluded.tooling_details",item.code,item.name,item.kind,item.provider,item.cost_kg,item.tool_type,JSON.stringify(item.details));
  const productId=one('SELECT id FROM products WHERE code=?',item.code).id;
  if(!one('SELECT id FROM lots WHERE product_id=?',productId)){const lotId=Number(run('INSERT INTO lots(product_id,lot,entry_date,shelf_days,cost_kg,grams) VALUES(?,?,?,0,?,1)',productId,item.lot,today(),item.cost_kg).lastInsertRowid);run("INSERT INTO movements(lot_id,type,grams,cost_kg,date,reason) VALUES(?,'in',1,?,?,?)",lotId,item.cost_kg,today(),'Alta de herramental · Inventario de Hernamentales.pdf · '+item.code);}
 }
 run("INSERT INTO metadata VALUES('tooling_pdf_20261104_v1','1')");
});
if(!all('PRAGMA table_info(orders)').some(c=>c.name==='ink_selections'))db.exec("ALTER TABLE orders ADD COLUMN ink_selections TEXT NOT NULL DEFAULT '[]'");
db.exec(`CREATE TABLE IF NOT EXISTS pantone_requests(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id),slot INTEGER NOT NULL,pantone TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,prepared_at TEXT,output_grams REAL,output_lot_id INTEGER REFERENCES lots(id),UNIQUE(order_id,slot));CREATE TABLE IF NOT EXISTS pantone_ingredients(id INTEGER PRIMARY KEY,request_id INTEGER NOT NULL REFERENCES pantone_requests(id),lot_id INTEGER NOT NULL REFERENCES lots(id),grams REAL NOT NULL,cost_kg REAL NOT NULL);`);
function completePantone(b){
 const request=one('SELECT * FROM pantone_requests WHERE id=?',Number(b.id));if(!request)fail('Solicitud no encontrada.');if(request.status==='completed')return {id:request.id,output_lot_id:request.output_lot_id};
 const o=one('SELECT * FROM orders WHERE id=?',request.order_id);if(o.status==='cancelled')fail('La orden está cancelada.');
 const d=date(today()),recipe=mixtureRecipe(b);let totalCost=0;
 const lots=recipe.ingredients.map(i=>{const lot=one("SELECT l.*,p.category FROM lots l JOIN products p ON p.id=l.product_id WHERE l.id=?",i.lot_id);if(!lot||lot.category!=='tinta'||lot.grams<i.grams)fail('Existencia insuficiente en un ingrediente.');totalCost+=i.grams*lot.cost_kg/1000;return {...i,cost_kg:lot.cost_kg};});
 const code='MIX-PANTONE-'+request.id;if(one('SELECT id FROM products WHERE code=?',code))fail('Ya existe el código de esta mezcla.');
 const costKg=totalCost/(recipe.outputGrams/1000),productId=Number(run("INSERT INTO products(code,name,kind,provider,category,minimum,cost_kg) VALUES(?,?,'Mezcla','Preparación interna','tinta',0,?)",code,'Pantone '+request.pantone,costKg).lastInsertRowid);
 const outputLot=Number(run('INSERT INTO lots(product_id,lot,entry_date,shelf_days,cost_kg,grams) VALUES(?,?,?,?,?,?)',productId,'MIX-'+request.id+'-'+d,d,365,costKg,recipe.outputGrams).lastInsertRowid);
 for(const i of lots){run('UPDATE lots SET grams=? WHERE id=?',decimalDifference(one('SELECT grams FROM lots WHERE id=?',i.lot_id).grams,i.grams),i.lot_id);run('INSERT INTO pantone_ingredients(request_id,lot_id,grams,cost_kg) VALUES(?,?,?,?)',request.id,i.lot_id,i.grams,i.cost_kg);run("INSERT INTO movements(lot_id,type,grams,cost_kg,date,reason,order_id) VALUES(?,'out',?,?,?,?,?)",i.lot_id,i.grams,i.cost_kg,d,'Preparación Pantone '+request.pantone+' · '+o.folio,null);}
 run("INSERT INTO movements(lot_id,type,grams,cost_kg,date,reason,order_id) VALUES(?,'in',?,?,?,?,?)",outputLot,recipe.outputGrams,costKg,d,'Mezcla Pantone '+request.pantone+' · '+o.folio,null);
 run("UPDATE pantone_requests SET status='completed',prepared_at=?,output_grams=?,output_lot_id=? WHERE id=?",new Date().toISOString(),recipe.outputGrams,outputLot,request.id);return {id:request.id,output_lot_id:outputLot};
}
function manageOrderPortal(b){
 let access_key=null;
 if(b.operation==='configure'){access_key='op_'+randomBytes(32).toString('hex');run('INSERT INTO order_portal_access VALUES(1,?,1) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash,enabled=1',hashToken(access_key));}
 else if(b.operation==='disable')run('UPDATE order_portal_access SET enabled=0 WHERE id=1');
 else if(b.operation!=='status')fail('Acción no válida.');
 return {enabled:!!one('SELECT enabled FROM order_portal_access WHERE id=1')?.enabled,access_key};
}
db.exec(`CREATE TABLE IF NOT EXISTS order_comments(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id),body TEXT NOT NULL,author TEXT NOT NULL,created_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS order_status_access(id INTEGER PRIMARY KEY,token_hash TEXT NOT NULL,enabled INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS order_status_months(month TEXT PRIMARY KEY,report TEXT NOT NULL,updated_at TEXT NOT NULL);`);
function orderComments(b){const id=Number(b.order_id);if(!one('SELECT id FROM orders WHERE id=?',id))fail('Orden no encontrada.');if(b.operation==='add'){const body=required(b.body,'el comentario');if(body.length>2000)fail('El comentario admite hasta 2000 caracteres.');run('INSERT INTO order_comments(order_id,body,author,created_at) VALUES(?,?,?,?)',id,body,String(b.author||'Usuario autorizado').slice(0,100),new Date().toISOString());}else if(b.operation!=='list')fail('Acción no válida.');return {comments:all('SELECT id,body,author,created_at FROM order_comments WHERE order_id=? ORDER BY id',id)};}
db.exec(`CREATE TABLE IF NOT EXISTS order_status_credentials(id INTEGER PRIMARY KEY,username TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,failed_attempts INTEGER NOT NULL DEFAULT 0,window_started INTEGER NOT NULL DEFAULT 0);CREATE TABLE IF NOT EXISTS order_status_sessions(session_hash TEXT PRIMARY KEY,link_hash TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
run('INSERT OR IGNORE INTO order_status_credentials(id,username,salt,password_hash) VALUES(1,?,?,?)','1','7da3c236b5951e9fd198ffd6e03daa15','7f840e2e77749d3a7559c4a5d41616f2699e4a97c96a258c0459cfa667d02434');
function statusLogin(b){if(!/^st_[a-f0-9]{64}$/.test(b.access_key||'')||!one('SELECT id FROM order_status_access WHERE id=1 AND enabled=1 AND token_hash=?',hashToken(b.access_key)))return {error:'El enlace de consulta no está autorizado o fue desactivado.'};let credential=one('SELECT * FROM order_status_credentials WHERE id=1');const now=Date.now();if(now-credential.window_started>=600000){run('UPDATE order_status_credentials SET failed_attempts=0,window_started=? WHERE id=1',now);credential=one('SELECT * FROM order_status_credentials WHERE id=1');}if(credential.failed_attempts>=10)return {error:'Demasiados intentos. Intenta nuevamente en 10 minutos.'};if(typeof b.username!=='string'||typeof b.password!=='string'||b.username.trim()!==credential.username||b.password.length>128||!timingSafeEqual(scryptSync(b.password,Buffer.from(credential.salt,'hex'),32),Buffer.from(credential.password_hash,'hex'))){run('UPDATE order_status_credentials SET failed_attempts=failed_attempts+1 WHERE id=1');return {error:'Usuario o contraseña incorrectos.'};}run('UPDATE order_status_credentials SET failed_attempts=0,window_started=? WHERE id=1',now);run('DELETE FROM order_status_sessions WHERE expires_at<=?',now);const session_key='ss_'+randomBytes(32).toString('hex');run('INSERT INTO order_status_sessions VALUES(?,?,?)',hashToken(session_key),hashToken(b.access_key),now+3600000);return {session_key,expires_at:new Date(now+3600000).toISOString()};}
function statusLogout(b){run('DELETE FROM order_status_sessions WHERE session_hash=?',hashToken(String(b.session_key||'')));return {ok:true};}
function manageOrderStatus(b){let access_key=null;if(b.operation==='configure'){access_key='st_'+randomBytes(32).toString('hex');run('INSERT INTO order_status_access VALUES(1,?,1) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash,enabled=1',hashToken(access_key));}else if(b.operation==='disable')run('UPDATE order_status_access SET enabled=0 WHERE id=1');else if(b.operation!=='status')fail('Acción no válida.');return {enabled:!!one('SELECT enabled FROM order_status_access WHERE id=1')?.enabled,access_key};}
function orderStatusReport(b){if(typeof b.session_key!=='string'||!one('SELECT session_hash FROM order_status_sessions WHERE session_hash=? AND link_hash=? AND expires_at>?',hashToken(b.session_key),hashToken(String(b.access_key||'')),Date.now()))fail('Inicia sesión para consultar las órdenes.');if(!/^st_[a-f0-9]{64}$/.test(b.access_key||'')||!one('SELECT id FROM order_status_access WHERE id=1 AND enabled=1 AND token_hash=?',hashToken(b.access_key)))fail('El enlace de consulta no está autorizado o fue desactivado.');const month=b.month||today().slice(0,7);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail('Mes no válido.');const orders=all('SELECT * FROM orders ORDER BY queue_number,id'),months=[...new Set(orders.map(orderMonth).concat(month))],updatedAt=new Date().toISOString();for(const m of months)run('INSERT INTO order_status_months VALUES(?,?,?) ON CONFLICT(month) DO UPDATE SET report=excluded.report,updated_at=excluded.updated_at',m,JSON.stringify(orders.filter(o=>orderMonth(o)===m).map(publicOrderStatus)),updatedAt);return {time_settings:sharedTime(),month,months:all('SELECT month FROM order_status_months ORDER BY month DESC').map(r=>r.month),orders:JSON.parse(one('SELECT report FROM order_status_months WHERE month=?',month).report),updated_at:updatedAt};}
function siteTime(b){if(b.operation!=='save')fail('Acción no válida.');if(!validTimeZone(b.timeZone))fail('Zona horaria no válida.');const settings={...normalizeTimeSettings(b),timezoneMode:'custom'};run("INSERT INTO metadata(key,value) VALUES('site_time_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(settings));return {time_settings:settings};}
function orderInkOptions(b){if(b.operation==='get')return {options:JSON.parse(one("SELECT value FROM metadata WHERE key='order_ink_options'")?.value||'[]')};if(b.operation!=='save')fail('Acción no válida.');const options=normalizeInkOptions(b.options);for(const option of options)if(option.product_id){const p=one("SELECT * FROM products WHERE id=? AND category='tinta'",option.product_id);if(!p||inkFamily(p.kind)!==option.family)fail('La tinta relacionada debe ser del mismo tipo.');}run("INSERT INTO metadata(key,value) VALUES('order_ink_options',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(options));return {options};}
function orderPortal(b){
 if(typeof b.access_key!=='string'||!/^op_[a-f0-9]{64}$/.test(b.access_key)||!one('SELECT id FROM order_portal_access WHERE id=1 AND enabled=1 AND token_hash=?',hashToken(b.access_key)))fail('El enlace fue desactivado o cambió. Solicita el enlace vigente.');
 const payload=b.payload||{};
 if(payload.operation==='catalog')return {production_workflow_version:3,time_settings:sharedTime(),ink_options:orderInkOptions({operation:'get'}).options,tools:all("SELECT id,code,name,CASE WHEN code LIKE 'SJ%' THEN 'suaje' ELSE 'pleca' END AS tool_type FROM products WHERE category='herramental' AND (code LIKE 'SJ%' OR code LIKE 'PD%') ORDER BY name,code"),products:all("SELECT p.id,p.code,p.name,p.kind,p.provider,EXISTS(SELECT 1 FROM lots l WHERE l.product_id=p.id AND l.grams>0) AS available FROM products p WHERE p.category='tinta' ORDER BY p.name,p.code")};
 if(payload.operation==='list'){
  const cursor=Number(payload.after_sequence||0);if(!Number.isSafeInteger(cursor)||cursor<0)fail('Secuencia no válida.');
  const rows=all("SELECT id,queue_number,folio,np,product,client,pressman,machine,scheduled_date,scheduled_start,scheduled_end,pieces,planned_meters,specifications,notes,status,started_at,ended_at,received_at FROM orders WHERE source='portal' AND queue_number>? AND (?=1 OR (status<>'cancelled' AND ended_at IS NULL)) ORDER BY queue_number LIMIT 51",cursor,payload.include_finished===true?1:0).map(({specifications,...o})=>({...o,colors:JSON.parse(specifications).colores||'',die:JSON.parse(specifications).suaje||'',crease:JSON.parse(specifications).pleca||'',ink_family:JSON.parse(specifications).tipo_tinta||''}));
  return {orders:rows.slice(0,50),has_more:rows.length>50,time_settings:sharedTime()};
 }
 if(payload.operation!=='submit')fail('Acción no permitida.');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.request_key||''))fail('Falta la referencia de captura.');
 const item=resolveOrderInks(normalizePortalOrder(payload.order),orderInkOptions({operation:'get'}).options,all('SELECT * FROM products')),signature=hashToken(JSON.stringify(item)),old=one('SELECT * FROM order_portal_submissions WHERE request_key=?',payload.request_key);
 if(old){if(old.payload_hash!==signature)fail('La captura ya fue enviada con otros datos. Recarga la lista antes de crear otra.');return {id:old.order_id,queue_number:one('SELECT queue_number FROM orders WHERE id=?',old.order_id).queue_number,duplicate:true};}
 if(one("SELECT id FROM orders WHERE source='portal' AND status<>'cancelled' AND upper(trim(folio))=upper(?) AND np=? AND scheduled_date=?",item.folio,item.np,item.scheduled_date))fail('Esta orden y NP ya están registrados para esa fecha. Revisa la lista.');
 if(item.ink_selections?.length)item.colors=item.ink_selections.map(i=>{if(i.pantone)return 'Pantone '+i.pantone;const p=one("SELECT * FROM products WHERE id=? AND category='tinta'",i.product_id);if(!p)fail('Tinta del catálogo no encontrada.');return p.name+' ['+p.code+']'+(i.ink_family?' ('+i.ink_family+')':'');}).join(' · ');
 const n=one('SELECT coalesce(max(queue_number),0)+1 AS n FROM orders').n;
 const id=Number(run("INSERT INTO orders(folio,np,product,client,pressman,machine,date,status,source,received_at,queue_number,scheduled_date,scheduled_start,scheduled_end,pieces,planned_meters,specifications,notes) VALUES(?,?,?,?,?,?,?,'draft','portal',?,?,?,?,?,?,?,?,?)",item.folio,item.np,item.product,item.client,item.pressman,item.machine,today(),new Date().toISOString(),n,item.scheduled_date,item.scheduled_start,item.scheduled_end||null,item.pieces,item.meters,JSON.stringify({colores:item.colors}),item.notes).lastInsertRowid);
 const specs={production_plan:item.production_plan,colores:item.colors,...(orderInkSummary(item)?{tipo_tinta:orderInkSummary(item)}:{})};for(const [key,type,label] of [['die_id','suaje','suaje'],['crease_id','pleca','pleca']])if(item[key]){const tool=one("SELECT * FROM products WHERE id=? AND category='herramental'",item[key]);if(!tool||!tool.code.startsWith(type==='suaje'?'SJ':'PD'))fail('Herramental no válido para '+label+'.');specs[label]=tool.code+' · '+tool.name;specs[key]=tool.id;}run('UPDATE orders SET specifications=? WHERE id=?',JSON.stringify(specs),id);
 run('UPDATE orders SET ink_selections=? WHERE id=?',JSON.stringify(item.ink_selections||[]),id);for(const ink of item.ink_selections||[])if(ink.pantone)run('INSERT INTO pantone_requests(order_id,slot,pantone,created_at) VALUES(?,?,?,?)',id,ink.slot,ink.pantone,new Date().toISOString());
 run('INSERT INTO order_portal_submissions VALUES(?,?,?)',payload.request_key,id,signature);return {id,queue_number:n,duplicate:false};
}
const hashToken=token=>createHash('sha256').update(token).digest('hex');
db.exec(`CREATE TABLE IF NOT EXISTS press_sheets(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),profile_id TEXT NOT NULL,access_key TEXT NOT NULL UNIQUE,source TEXT NOT NULL,fields TEXT NOT NULL DEFAULT '{}',version INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
for(const [column,type]of Object.entries({rewind_key:'TEXT',bobinas:"TEXT NOT NULL DEFAULT '[]'"}))if(!db.prepare('PRAGMA table_info(press_sheets)').all().some(c=>c.name===column))db.exec(`ALTER TABLE press_sheets ADD COLUMN ${column} ${type}`);
function ensureSheetFlow(row){if(!row.rewind_key){run('UPDATE press_sheets SET rewind_key=?,bobinas=? WHERE id=?','rw_'+randomBytes(32).toString('hex'),JSON.stringify(plannedBobinas(JSON.parse(row.source).planned_meters,JSON.parse(row.source).production_plan?.reel_meters||1500)),row.id);row=one('SELECT * FROM press_sheets WHERE id=?',row.id);}return row;}
function sheetData(row){return {...row,source:JSON.parse(row.source),fields:JSON.parse(row.fields),bobinas:JSON.parse(row.bobinas)};}
db.exec(`CREATE TABLE IF NOT EXISTS press_queues(profile_id TEXT PRIMARY KEY,production_key TEXT NOT NULL UNIQUE,rewind_key TEXT NOT NULL UNIQUE);`);
function pressQueue(b){if(!/^(pq|rq)_[a-f0-9]{64}$/.test(b.access_key||''))fail('Enlace no autorizado.');const q=one('SELECT * FROM press_queues WHERE production_key=? OR rewind_key=?',b.access_key,b.access_key);if(!q)fail('Enlace no autorizado.');const stage=q.production_key===b.access_key?'production':'rewind';return {workflow_version:3,stage,sheets:all("SELECT s.* FROM press_sheets s JOIN orders o ON o.id=s.order_id WHERE s.profile_id=? AND o.status<>'cancelled' ORDER BY s.id",q.profile_id).map(ensureSheetFlow).map(sheetData).filter(row=>stage==='production'?(one('SELECT status FROM orders WHERE id=?',row.order_id).status!=='confirmed'&&!JSON.parse(row.runtime||'{}').ended_at&&row.bobinas.some(b=>!b.produced_at)):row.bobinas.some(b=>b.produced_at&&!b.rewound_at)).map(row=>({id:row.id,source:{folio:row.source.folio,np:row.source.np,product:row.source.product,machine:row.source.machine,date:row.source.date,planned_meters:row.source.planned_meters},bobinas:row.bobinas,access_key:stage==='production'?row.access_key:row.rewind_key}))};}
function pressSheetsV2(b){
 if(b.operation==='list'){
  if(!one("SELECT * FROM press_queues WHERE profile_id='local'"))run("INSERT INTO press_queues VALUES('local',?,?)",'pq_'+randomBytes(32).toString('hex'),'rq_'+randomBytes(32).toString('hex'));
  for(const order of all("SELECT id FROM orders WHERE status<>'cancelled' AND (ended_at IS NOT NULL OR status='confirmed') AND id NOT IN(SELECT order_id FROM press_sheets)"))pressSheets({operation:'generate',order_id:order.id,profile:b.profile});
  return {workflow_version:2,links:one("SELECT production_key,rewind_key FROM press_queues WHERE profile_id='local'"),sheets:all("SELECT * FROM press_sheets WHERE profile_id='local' ORDER BY id DESC").map(ensureSheetFlow).map(sheetData).map(row=>({...row,source:{...row.source,reportLogo:undefined,colors:undefined},fields:undefined}))};
 }
 if(b.operation!=='generate')fail('Acción no válida.');const order=one('SELECT * FROM orders WHERE id=?',Number(b.order_id));if(!order||(!order.ended_at&&order.status!=='confirmed')||order.status==='cancelled')fail('Primero finaliza la preparación de la orden.');let row=one('SELECT * FROM press_sheets WHERE order_id=?',order.id);if(!row){const snapshot=pressSheetSnapshot({...order,specifications:JSON.parse(order.specifications||'{}'),ink_selections:JSON.parse(order.ink_selections||'[]')},all('SELECT * FROM products'),{...(b.profile||{}),timeZone:requestTime.getStore()?.timeZone||sharedTime().timeZone}),now=new Date().toISOString();if(!snapshot.planned_meters){const historical=one('SELECT MAX(meters) AS meters FROM order_items WHERE order_id=?',order.id);snapshot.planned_meters=historical?.meters||null;}const id=Number(run("INSERT INTO press_sheets(order_id,profile_id,access_key,source,created_at,updated_at) VALUES(?,'local',?,?,?,?)",order.id,'ps_'+randomBytes(32).toString('hex'),JSON.stringify(snapshot),now,now).lastInsertRowid);row=one('SELECT * FROM press_sheets WHERE id=?',id);}return sheetData(ensureSheetFlow(row));
}
function pressSheetPublicV2(b){if(!/^(ps|rw)_[a-f0-9]{64}$/.test(b.access_key||''))fail('Enlace no autorizado.');let row=one('SELECT * FROM press_sheets WHERE access_key=? OR rewind_key=?',b.access_key,b.access_key);if(!row)fail('Enlace no autorizado.');row=ensureSheetFlow(row);const stage=row.access_key===b.access_key?'production':'rewind',order=one('SELECT status FROM orders WHERE id=?',row.order_id),cancelled=order?.status==='cancelled';let bobinas=JSON.parse(row.bobinas);if(b.operation!=='get'){
 if(!['save','complete_bobina'].includes(b.operation))fail('Acción no válida.');if(cancelled)fail('La orden fue cancelada. Solo se puede consultar.');if(Number(b.version)!==row.version)fail('Otra persona actualizó el formato. Recarga antes de guardar.');if(stage==='rewind'&&!bobinas.some(r=>r.produced_at))fail('Rebobinado estará disponible al terminar la primera bobina.');
 if(b.operation==='save'){const fields=normalizePressFields(b.fields);if(Object.keys(fields).some(k=>!stageFields(stage).includes(k)))fail('Campo no permitido en esta etapa.');run('UPDATE press_sheets SET fields=?,version=version+1,updated_at=? WHERE id=?',JSON.stringify({...JSON.parse(row.fields),...fields}),new Date().toISOString(),row.id);}else{bobinas=completeBobina(bobinas,stage,b.number,new Date().toISOString());if(JSON.stringify(bobinas)!==row.bobinas)run('UPDATE press_sheets SET bobinas=?,version=version+1,updated_at=? WHERE id=?',JSON.stringify(bobinas),new Date().toISOString(),row.id);}row=one('SELECT * FROM press_sheets WHERE id=?',row.id);
 }const parsed=sheetData(row);return {id:row.id,source:parsed.source,fields:Object.fromEntries(Object.entries(parsed.fields).filter(([k])=>stageFields(stage).includes(k))),stage,bobinas:parsed.bobinas,rewind_ready:parsed.bobinas.some(r=>r.produced_at),version:row.version,created_at:row.created_at,updated_at:row.updated_at,cancelled};}

if(!db.prepare('PRAGMA table_info(press_sheets)').all().some(c=>c.name==='runtime'))db.exec("ALTER TABLE press_sheets ADD COLUMN runtime TEXT NOT NULL DEFAULT '{}'");
function fullSheet(row){return {...sheetData(row),runtime:JSON.parse(row.runtime||'{}')};}
function refreshSheetPlan(row){const sheet=fullSheet(row),o=one('SELECT specifications FROM orders WHERE id=?',row.order_id),plan=JSON.parse(o.specifications||'{}').production_plan||{};if(!sheet.runtime.started_at&&!sheet.bobinas.some(b=>b.produced_at)&&Object.keys(plan).length&&JSON.stringify(plan)!==JSON.stringify(sheet.source.production_plan||{})){sheet.source.production_plan=plan;sheet.bobinas=plannedBobinas(sheet.source.planned_meters,plan.reel_meters||1500);run('UPDATE press_sheets SET source=?,bobinas=?,version=version+1 WHERE id=?',JSON.stringify(sheet.source),JSON.stringify(sheet.bobinas),row.id);return one('SELECT * FROM press_sheets WHERE id=?',row.id);}return row;}
function pressSheets(b){const result=pressSheetsV2(b);if(b.operation==='list'){const sheets=result.sheets.map(s=>{const row=refreshSheetPlan(one('SELECT * FROM press_sheets WHERE id=?',s.id)),parsed=fullSheet(row);const {runtime,...safe}=parsed;return {...safe,source:{...safe.source,reportLogo:undefined,colors:undefined},fields:undefined};});return {...result,workflow_version:3,sheets};}const parsed=fullSheet(refreshSheetPlan(one('SELECT * FROM press_sheets WHERE id=?',result.id)));const {runtime,...safe}=parsed;return safe;}
function syncSheetIncidents(row){const order=one('SELECT status FROM orders WHERE id=?',row.order_id),current=fullSheet(row);if(['confirmed','cancelled'].includes(order.status)&&current.runtime.started_at&&!current.runtime.ended_at){const now=new Date().toISOString();current.runtime.ended_at=now;current.runtime.closed_by_order=order.status;current.runtime.stops=(current.runtime.stops||[]).map(s=>({...s,ended_at:s.ended_at||now}));run('UPDATE press_sheets SET runtime=?,version=version+1 WHERE id=?',JSON.stringify(current.runtime),row.id);row=one('SELECT * FROM press_sheets WHERE id=?',row.id);}const sheet=fullSheet(row),updated=syncMachineIncidents(sheet,all('SELECT * FROM incidents WHERE order_id=?',row.order_id));if(JSON.stringify(sheet.runtime)!==JSON.stringify(updated.runtime)){run('UPDATE press_sheets SET runtime=?,version=version+1 WHERE id=?',JSON.stringify(updated.runtime),row.id);return one('SELECT * FROM press_sheets WHERE id=?',row.id);}return row;}
function pressSheetPublic(b){if(!/^(ps|rw)_[a-f0-9]{64}$/.test(b.access_key||''))fail('Enlace no autorizado.');let row=one('SELECT * FROM press_sheets WHERE access_key=? OR rewind_key=?',b.access_key,b.access_key);if(!row)fail('Enlace no autorizado.');row=syncSheetIncidents(refreshSheetPlan(row));const isProduction=row.access_key===b.access_key,order=one('SELECT status FROM orders WHERE id=?',row.order_id),closed=isProduction&&order.status==='confirmed';
 if(b.operation!=='get'&&(closed||order.status==='cancelled'))fail('La orden ya está cerrada o cancelada. Solo consulta.');
 if(isProduction&&['start_production','start_bobina','complete_bobina','pause','resume'].includes(b.operation)){
  if(Number(b.version)!==row.version)fail('Otra persona actualizó el formato. Pulsa Actualizar.');
  if(b.operation==='start_production'){const source=JSON.parse(row.source);if(all('SELECT * FROM press_sheets WHERE id<>?',row.id).some(s=>{const r=JSON.parse(s.runtime||'{}');return r.started_at&&!r.ended_at&&JSON.parse(s.source).machine===source.machine&&one('SELECT status FROM orders WHERE id=?',s.order_id).status==='draft';}))fail('Esta máquina tiene otra producción en curso.');}
  let sheet=productionAction(fullSheet(row),b.operation,b,new Date().toISOString());sheet=syncMachineIncidents(sheet,all('SELECT * FROM incidents WHERE order_id=?',row.order_id));run('UPDATE press_sheets SET runtime=?,bobinas=?,version=version+1,updated_at=? WHERE id=?',JSON.stringify(sheet.runtime),JSON.stringify(sheet.bobinas),new Date().toISOString(),row.id);
 }else{if(isProduction&&b.operation==='save'&&JSON.parse(row.runtime||'{}').ended_at)fail('La producción ya terminó.');if(isProduction&&b.operation==='save'&&Object.keys(b.fields||{}).some(k=>!['observations','press_signature'].includes(k)))fail('Los datos de planeación se capturan en la orden; los metros se registran por bobina.');pressSheetPublicV2(b);}
 row=one('SELECT * FROM press_sheets WHERE id=?',row.id);const result=pressSheetPublicV2({access_key:b.access_key,operation:'get'}),{runtime,...safe}=result;return {...safe,workflow_version:3,closed,...publicProduction(fullSheet(row),new Date().toISOString())};
}
function productionAudit(b){const day=b.date||today();if(!/^\d{4}-\d{2}-\d{2}$/.test(day))fail('Fecha no válida.');const rows=all('SELECT * FROM press_sheets').map(syncSheetIncidents).map(fullSheet).filter(s=>s.runtime.started_at).map(s=>privateProduction(s,new Date().toISOString()));return {date:day,time_settings:sharedTime(),sessions:dailyProductionAudit(rows,day,{timezoneMode:'custom',timeZone:requestTime.getStore()?.timeZone||sharedTime().timeZone},new Date().toISOString()),references:{bathroom_visits:3,bathroom_minutes:10,meal_minutes:45}};}

function orderClock(b){
 const row=one('SELECT * FROM orders WHERE id=?',Number(b.id));if(!row||row.status==='cancelled')fail('Orden no encontrada o cancelada.');
 if(b.operation==='start'){if(row.ended_at)fail('La orden ya finalizó.');run('UPDATE orders SET started_at=coalesce(started_at,?) WHERE id=?',new Date().toISOString(),row.id);}
 else if(b.operation==='finish'){if(one("SELECT id FROM pantone_requests WHERE order_id=? AND status='pending'",row.id))fail('Completa las solicitudes de Pantone antes de finalizar la preparación.');if(!row.started_at)fail('Primero inicia la orden.');run('UPDATE orders SET ended_at=coalesce(ended_at,?) WHERE id=?',new Date().toISOString(),row.id);}
 else fail('Acción de cronómetro no válida.');
 return {...one('SELECT id,started_at,ended_at FROM orders WHERE id=?',row.id),...(b.operation==='finish'?{press_sheet:pressSheets({operation:'generate',order_id:row.id,profile:b.profile})}:{})};
}
function teamsConnection(b){
 let token=null;
 if(b.operation==='configure'){const chat=required(b.conversation_id,'el ID del chat autorizado');if(chat.length>500)fail('ID demasiado largo.');token='tt_'+randomBytes(32).toString('hex');run('INSERT INTO teams_connection VALUES(1,?,?,1) ON CONFLICT(id) DO UPDATE SET conversation_id=excluded.conversation_id,token_hash=excluded.token_hash,enabled=1',chat,hashToken(token));}
 else if(b.operation==='disable')run('UPDATE teams_connection SET enabled=0 WHERE id=1');
 else if(b.operation!=='status')fail('Acción no válida.');
 const row=one('SELECT * FROM teams_connection WHERE id=1');return {enabled:!!row?.enabled,conversation_id:row?.conversation_id||'',token};
}
function receiveTeams(b,token){
 if(typeof token!=='string'||!/^tt_[a-f0-9]{64}$/.test(token))fail('Conexión no autorizada.');
 const connection=one('SELECT * FROM teams_connection WHERE id=1 AND enabled=1 AND token_hash=?',hashToken(token));
 if(!connection||connection.conversation_id!==b.conversation_id)fail('Conexión o chat no autorizado.');
 const msg=required(b.message_id,'message_id');if(msg.length>500)fail('ID de mensaje demasiado largo.');
 const old=one('SELECT order_ids FROM teams_receipts WHERE conversation_id=? AND message_id=?',b.conversation_id,msg);if(old)return {duplicate:true,order_ids:JSON.parse(old.order_ids)};
 const parsed=parseTeamsOrders(b.html),ids=[];
 for(const item of parsed){
  if(item.folio.length>100||item.np.length>100||item.product.length>150||item.client.length>150)fail('Datos de orden demasiado largos.');
  const existing=one("SELECT * FROM orders WHERE source='teams' AND status<>'cancelled' AND folio=? AND np=? AND scheduled_date IS ? ORDER BY id LIMIT 1",item.folio,item.np,item.scheduled_date);
  if(existing){if(existing.product!==item.product||existing.client!==item.client||existing.pieces!==item.pieces||existing.planned_meters!==item.meters||existing.scheduled_start!==item.scheduled_start||existing.scheduled_end!==item.scheduled_end||existing.specifications!==JSON.stringify(item.specifications))fail('La orden ya existe con datos diferentes.');ids.push(existing.id);continue;}
  ids.push(Number(run("INSERT INTO orders(folio,np,client,product,date,status,source,received_at,scheduled_date,scheduled_start,scheduled_end,pieces,planned_meters,specifications) VALUES(?,?,?,?,?,'draft','teams',?,?,?,?,?,?,?)",item.folio,item.np,item.client,item.product,today(),new Date().toISOString(),item.scheduled_date,item.scheduled_start,item.scheduled_end,item.pieces,item.meters,JSON.stringify(item.specifications)).lastInsertRowid));
 }
 run('INSERT INTO teams_receipts VALUES(?,?,?)',b.conversation_id,msg,JSON.stringify(ids));return {duplicate:false,order_ids:ids};
}
function state() {
  return {incidents:all('SELECT * FROM incidents ORDER BY incident_number DESC').map(({before_photo,after_photo,...i})=>({...i,has_before:!!before_photo,has_after:!!after_photo,elapsed_seconds:incidentSeconds(i),folio:incidentFolio(i.incident_number)})),preparations:all('SELECT * FROM preparations ORDER BY date DESC,start_time DESC,id DESC'),today:today(),baseline:one("SELECT value FROM metadata WHERE key='baseline'").value,
    pantone_requests:all('SELECT * FROM pantone_requests ORDER BY id').map(r=>({...r,ingredients:all('SELECT i.*,p.name,p.code,l.lot FROM pantone_ingredients i JOIN lots l ON l.id=i.lot_id JOIN products p ON p.id=l.product_id WHERE request_id=?',r.id)})),
    products:all('SELECT * FROM products ORDER BY name').map(p=>({...p,tooling_details:JSON.parse(p.tooling_details||'{}')})),
    lots:all('SELECT l.*,p.name,p.code,p.kind,p.provider,p.category,p.minimum,p.maximum,p.container_grams,p.tooling_details FROM lots l JOIN products p ON p.id=l.product_id ORDER BY p.name,l.entry_date').map(l=>({...l,tooling_details:JSON.parse(l.tooling_details||'{}')})),
    movements:all('SELECT m.*,p.name,p.code,l.lot FROM movements m JOIN lots l ON m.lot_id=l.id JOIN products p ON p.id=l.product_id ORDER BY m.date DESC,m.id DESC'),
    orders:all('SELECT * FROM orders ORDER BY date DESC,id DESC').map(o=>({...o,specifications:JSON.parse(o.specifications||'{}'),ink_selections:JSON.parse(o.ink_selections||'[]'),lines:all('SELECT i.*,p.name,p.code,l.lot FROM order_items i JOIN lots l ON i.lot_id=l.id JOIN products p ON l.product_id=p.id WHERE order_id=? ORDER BY i.id',o.id)})),
    cuts:all('SELECT * FROM cuts ORDER BY month DESC').map(c=>({...c,snapshot:JSON.parse(c.snapshot)}))};
}
function startIncident(b){
 const old=b.request_key?one('SELECT * FROM incidents WHERE request_key=?',String(b.request_key)):null;
 if(old){if(old.order_id!==Number(b.order_id))fail('Esta captura ya está vinculada a otra orden.');return {id:old.id,folio:incidentFolio(old.incident_number),started_at:old.started_at};}
 const o=one('SELECT * FROM orders WHERE id=?',Number(b.order_id));if(!o)fail('Selecciona una orden registrada.');
 const n=one('SELECT coalesce(max(incident_number),10)+1 AS n FROM incidents').n,started=new Date().toISOString();
 const nps=[...new Set([o.np,...all("SELECT DISTINCT np FROM order_items WHERE order_id=? AND np<>''",o.id).map(row=>row.np)].filter(Boolean).map(value=>value.trim()))],np=b.np?String(b.np).trim():(nps.length===1?nps[0]:'');if(np&&!nps.includes(np))fail('El NP no pertenece a esa orden.');
 const result=run("INSERT INTO incidents(incident_number,date,order_id,order_ref,np,machine,description,responsible,impact,status,request_key,timer_mode,started_at) VALUES(?,?,?,?,?,'','Registro en curso','','','Abierta',?,1,?)",n,today(),o.id,o.folio,np,b.request_key?String(b.request_key):null,started);
 return {id:Number(result.lastInsertRowid),folio:incidentFolio(n),started_at:started};
}
function saveTimedIncident(b,old){
 if(Number(b.order_id)!==old.order_id)fail('La orden del cronómetro no se puede cambiar.');
 const finish=b.finish===true||!!old.ended_at;
 const merged={...old,...b};for(const key of ['before_photo','after_photo']){merged[key]=Object.hasOwn(b,key)?b[key]:old[key];if(merged[key])jpegPhoto(merged[key]);}
 if(finish&&(!merged.before_photo||!merged.after_photo))fail('Agrega la foto del defecto y la foto final para generar el formato.');
 for(const [key,allowed] of [['machine',incidentMachines],['responsible',incidentOwners],['impact',incidentImpacts]])if(merged[key]&&!allowed.includes(merged[key]))fail('Opción no válida para '+key+'.');
 const np=String(merged.np||'').trim();if(np&&!one("SELECT id FROM orders WHERE id=? AND trim(np)=? UNION SELECT order_id AS id FROM order_items WHERE order_id=? AND trim(np)=?",old.order_id,np,old.order_id,np))fail('El NP no pertenece a esa orden.');
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
 const np=String(b.np||'').trim();if(np&&!one("SELECT id FROM orders WHERE id=? AND trim(np)=? UNION SELECT order_id AS id FROM order_items WHERE order_id=? AND trim(np)=?",o.id,np,o.id,np))fail('El NP no pertenece a esa orden.');
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
  run('UPDATE lots SET grams=? WHERE id=?',decimalSum([l.grams,b.type==='in'?grams:-grams]),l.id);
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
      grams=final===null?0:decimalDifference(initial,final);
    }else grams=number(line.grams,'Gramos',0.001);
    const meters=line.meters===''||line.meters==null?null:number(line.meters,'Metros');
    items.push({lot_id:l.id,np,initial,final,grams,cost_kg:l.cost_kg,meters,notes:String(line.notes||'')});
    grouped.set(l.id,decimalSum([grouped.get(l.id)||0,grams]));
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
    run('UPDATE lots SET grams=? WHERE id=?',decimalDifference(l.grams,grams),lotId);
    run('INSERT INTO movements(lot_id,type,grams,cost_kg,date,reason,order_id) VALUES(?,?,?,?,?,?,?)',lotId,'out',grams,l.cost_kg,d,`Orden ${folio}`,id);
  }
}
function updateOrder(b){createOrder(b,Number(b.id));}

function cancelOrder(b) {
  const o=one('SELECT * FROM orders WHERE id=?',b.id);
  if(!o) fail('Orden no encontrada.');
  if(o.status==='cancelled') fail('La orden ya está cancelada.');
  date(o.date); const d=date(today());
  for(const m of all("SELECT * FROM movements WHERE order_id=? AND type='out' AND reason NOT LIKE 'Preparación Pantone %'",o.id)) {
    run('UPDATE lots SET grams=? WHERE id=?',decimalSum([one('SELECT grams FROM lots WHERE id=?',m.lot_id).grams,m.grams]),m.lot_id);
    run('INSERT INTO movements(lot_id,type,grams,cost_kg,date,reason,order_id) VALUES(?,?,?,?,?,?,?)',m.lot_id,'in',m.grams,m.cost_kg,d,`Cancelación ${o.folio}`,o.id);
  }
  run("UPDATE orders SET status='cancelled',ended_at=CASE WHEN started_at IS NOT NULL THEN coalesce(ended_at,?) ELSE ended_at END WHERE id=?",new Date().toISOString(),o.id);
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
      if(m.date.slice(0,7)<month || (m.type==='initial'&&m.date.slice(0,7)===month)) opening=decimalSum([opening,m.type==='out'?-m.grams:m.grams]);
      else if(m.type==='in') incoming=decimalSum([incoming,m.grams]);else if(m.type==='out') outgoing=decimalSum([outgoing,m.grams]);
    }
    return {lot_id:l.id,name:l.name,code:l.code,lot:l.lot,category:l.category,opening,incoming,outgoing,closing:decimalSum([opening,incoming,-outgoing]),cost_kg:l.cost_kg};
  });
  run('INSERT INTO cuts(month,created_at,snapshot) VALUES(?,?,?)',month,new Date().toISOString(),JSON.stringify(rows));
}
const mime={'.webmanifest':'application/manifest+json','.png':'image/png','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const clientTimeZone=req=>String(req.headers['x-client-info']||'').match(/time-zone=([^; ]+)/)?.[1];
const server=http.createServer((req,res)=>requestTime.run({timeZone:validTimeZone(clientTimeZone(req))?clientTimeZone(req):sharedTime().timeZone},async()=>{
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
      if(url.pathname==='/api/teams-orders'){const result=tx(()=>receiveTeams(b,req.headers['x-integration-key']));res.end(JSON.stringify({ok:true,...result}));return;}
      const actions={'/api/production-audit':productionAudit,'/api/press-queue':pressQueue,'/api/press-sheets':pressSheets,'/api/press-sheet':pressSheetPublic,'/api/site-time':siteTime,'/api/order-status/login':statusLogin,'/api/order-status/logout':statusLogout,'/api/order-comments':orderComments,'/api/order-status/manage':manageOrderStatus,'/api/order-status':orderStatusReport,'/api/order-ink-options':orderInkOptions,'/api/pantones/complete':completePantone,'/api/order-portal':orderPortal,'/api/order-portal/manage':manageOrderPortal,'/api/orders/clock':orderClock,'/api/teams/connection':teamsConnection,'/api/incidents/start':startIncident,'/api/incidents':saveIncident,'/api/preparations':savePreparation,'/api/movements':move,'/api/products':product,'/api/orders':createOrder,'/api/orders/update':updateOrder,'/api/orders/cancel':cancelOrder,'/api/cuts':closeMonth};
      if(!actions[url.pathname]) fail('Ruta no encontrada.');
      const result=tx(()=>{const result=actions[url.pathname](b);if(['/api/incidents','/api/incidents/start','/api/orders','/api/orders/update','/api/orders/cancel'].includes(url.pathname))all("SELECT * FROM press_sheets WHERE runtime<>'{}'").forEach(syncSheetIncidents);return result;});res.end(JSON.stringify({ok:true,...(result||{})}));return;
    }
    if(req.method!=='GET') {res.writeHead(405);res.end();return;}
    const file=path.join(root,'public',url.pathname==='/'?'index.html':url.pathname);
    if(!file.startsWith(path.join(root,'public')+path.sep)||!existsSync(file)) {res.writeHead(404);res.end('No encontrado');return;}
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
    res.setHeader('X-Content-Type-Options','nosniff');res.end(readFileSync(file));
  } catch(e) {res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:e.message}));}
}));
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log(`Inventario listo en puerto ${process.env.PORT||3000}`));
