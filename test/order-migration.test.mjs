import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
test('upgrading existing orders preserves balances, links and historical consumption across restarts',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'prisma-migration-')),dbPath=join(dir,'legacy.sqlite');
 const db=new DatabaseSync(dbPath),date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 db.exec(`CREATE TABLE products(id INTEGER PRIMARY KEY,code TEXT UNIQUE,name TEXT,kind TEXT,provider TEXT,category TEXT DEFAULT 'tinta',minimum REAL DEFAULT 1000);
 CREATE TABLE lots(id INTEGER PRIMARY KEY,product_id INTEGER REFERENCES products(id),lot TEXT,entry_date TEXT,shelf_days INTEGER,cost_kg REAL,grams REAL,UNIQUE(product_id,lot));
 CREATE TABLE orders(id INTEGER PRIMARY KEY,folio TEXT UNIQUE,client TEXT,date TEXT,notes TEXT DEFAULT '',status TEXT DEFAULT 'confirmed');
 CREATE TABLE movements(id INTEGER PRIMARY KEY,lot_id INTEGER REFERENCES lots(id),type TEXT,grams REAL,cost_kg REAL,date TEXT,reason TEXT,order_id INTEGER REFERENCES orders(id));
 CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
 INSERT INTO products(id,code,name,kind,provider) VALUES(1,'OLD-1','Histórica','Base Agua','Proveedor');`);
 db.prepare('INSERT INTO lots VALUES(1,1,?,?,?,?,?)').run('LEGACY-LOT',date,365,100,900);
 db.prepare('INSERT INTO orders(id,folio,client,date) VALUES(7,?,?,?)').run('OP-LEGACY','Cliente',date);
 db.prepare('INSERT INTO movements VALUES(1,1,?,?,?,?,?,NULL)').run('initial',1000,100,date,'Carga inicial');
 db.prepare('INSERT INTO movements VALUES(2,1,?,?,?,?,?,7)').run('out',100,100,date,'Orden OP-LEGACY');
 db.prepare("INSERT INTO metadata VALUES('seeded','1')").run();db.prepare("INSERT INTO metadata VALUES('inventory_pdf_corrected_v1','1')").run();db.prepare("INSERT INTO metadata VALUES('baseline',?)").run(date);db.close();
 const port=18000+Math.floor(Math.random()*1000);
 try{for(let attempt=0;attempt<2;attempt++){
  const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),DB_PATH:dbPath},stdio:['ignore','pipe','pipe']});
  try{
   await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Startup timeout')),10000);server.stdout.on('data',d=>{if(String(d).includes('Inventario listo')){clearTimeout(timeout);resolve()}});server.once('exit',code=>{clearTimeout(timeout);reject(Error('Startup failed '+code))});});
   const s=await(await fetch(`http://127.0.0.1:${port}/api/state`)).json();
   assert.equal(s.lots.filter(l=>l.category==='tinta').length,1);assert.equal(s.lots.find(l=>l.id===1).grams,900);assert.equal(s.movements.filter(m=>m.lot_id===1).length,2);assert.equal(s.lots.filter(l=>l.category==='herramental').length,154);assert.equal(s.movements.filter(m=>m.reason.startsWith('Alta de herramental')).length,154);assert.equal(s.orders[0].id,7);assert.equal(s.orders[0].folio,'OP-LEGACY');assert.equal(s.orders[0].lines.length,1);assert.equal(s.orders[0].lines[0].grams,100);assert.equal(s.orders[0].lines[0].initial_grams,null);
  }finally{if(server.exitCode===null){const ended=new Promise(r=>server.once('exit',r));server.kill();await ended;}}
 }
 const check=new DatabaseSync(dbPath);assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(),[]);check.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
