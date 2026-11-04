import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { canonicalCode } from './public/inventory-model.js';

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
function state() {
  return {today:today(),baseline:one("SELECT value FROM metadata WHERE key='baseline'").value,
    products:all('SELECT * FROM products ORDER BY name'),
    lots:all('SELECT l.*,p.name,p.code,p.kind,p.provider,p.category,p.minimum,p.maximum,p.container_grams FROM lots l JOIN products p ON p.id=l.product_id ORDER BY p.name,l.entry_date'),
    movements:all('SELECT m.*,p.name,p.code,l.lot FROM movements m JOIN lots l ON m.lot_id=l.id JOIN products p ON p.id=l.product_id ORDER BY m.date DESC,m.id DESC'),
    orders:all('SELECT * FROM orders ORDER BY date DESC,id DESC').map(o=>({...o,lines:all('SELECT m.*,p.name,p.code,l.lot FROM movements m JOIN lots l ON m.lot_id=l.id JOIN products p ON l.product_id=p.id WHERE order_id=? AND type=\'out\'',o.id)})),
    cuts:all('SELECT * FROM cuts ORDER BY month DESC').map(c=>({...c,snapshot:JSON.parse(c.snapshot)}))};
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
function createOrder(b) {
  const d=date(b.date),folio=required(b.folio,'el folio'),client=required(b.client,'el cliente');
  if(one('SELECT id FROM orders WHERE folio=?',folio)) fail('Ya existe una orden con ese folio.');
  if(!Array.isArray(b.lines)||!b.lines.length) fail('Agrega al menos una tinta.');
  const grouped=new Map();
  for(const line of b.lines) grouped.set(Number(line.lot_id),(grouped.get(Number(line.lot_id))||0)+number(line.grams,'Gramos',0.001));
  for(const [id,grams] of grouped) {
    const l=one('SELECT l.*,p.category FROM lots l JOIN products p ON p.id=l.product_id WHERE l.id=?',id);
    if(!l || l.category!=='tinta') fail('Selecciona un lote de tinta.');
    if(l.grams<grams) fail(`Existencia insuficiente en el lote ${l.lot}.`);
  }
  const id=run('INSERT INTO orders(folio,client,date,notes) VALUES(?,?,?,?)',folio,client,d,String(b.notes||'')).lastInsertRowid;
  for(const [lotId,grams] of grouped) {
    const l=one('SELECT * FROM lots WHERE id=?',lotId);
    run('UPDATE lots SET grams=grams-? WHERE id=?',grams,lotId);
    run('INSERT INTO movements(lot_id,type,grams,cost_kg,date,reason,order_id) VALUES(?,?,?,?,?,?,?)',lotId,'out',grams,l.cost_kg,d,`Orden ${folio}`,id);
  }
}
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
      if(req.method==='GET' && url.pathname==='/api/state') return res.end(JSON.stringify(state()));
      if(req.method!=='POST') {res.statusCode=404;return res.end(JSON.stringify({error:'Ruta no encontrada.'}));}
      if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}` && req.headers.origin!==`https://${req.headers.host}`) fail('Origen no permitido.');
      let raw='';for await(const chunk of req) {raw+=chunk;if(raw.length>100000) fail('Solicitud demasiado grande.');}
      const b=JSON.parse(raw||'{}');
      const actions={'/api/movements':move,'/api/products':product,'/api/orders':createOrder,'/api/orders/cancel':cancelOrder,'/api/cuts':closeMonth};
      if(!actions[url.pathname]) fail('Ruta no encontrada.');
      tx(()=>actions[url.pathname](b));res.end(JSON.stringify({ok:true}));return;
    }
    if(req.method!=='GET') {res.writeHead(405);res.end();return;}
    const file=path.join(root,'public',url.pathname==='/'?'index.html':url.pathname);
    if(!file.startsWith(path.join(root,'public')+path.sep)||!existsSync(file)) {res.writeHead(404);res.end('No encontrado');return;}
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
    res.setHeader('X-Content-Type-Options','nosniff');res.end(readFileSync(file));
  } catch(e) {res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:e.message}));}
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log(`Inventario listo en puerto ${process.env.PORT||3000}`));
