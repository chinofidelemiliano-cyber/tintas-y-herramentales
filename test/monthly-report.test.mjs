import {test} from 'node:test';
import assert from 'node:assert/strict';
import {monthlyMovementDetails} from '../public/inventory-model.js';
import {createTablePDF} from '../public/pdf-report.js';
test('monthly detail includes income, production expenses and returns, excludes opening balances and other months',()=>{
 const lots=[{lot_id:1,name:'Amarillo',code:'A1',lot:'L1',category:'tinta'},{id:2,name:'Anilox',code:'H1',lot:'H2',category:'herramental'}];
 const movements=[
 {id:1,lot_id:1,type:'initial',date:'2026-11-01',grams:4000,cost_kg:100},
 {id:2,lot_id:1,type:'in',date:'2026-11-01',grams:4000,cost_kg:100,reason:'Compra'},
 {id:3,lot_id:1,type:'out',date:'2026-11-30',grams:250,cost_kg:100,reason:'Orden OP-001'},
 {id:4,lot_id:1,type:'in',date:'2026-11-30',grams:250,cost_kg:100,reason:'Cancelación OP-001'},
 {id:5,lot_id:1,type:'out',date:'2026-10-31',grams:50,cost_kg:100},
 {id:6,lot_id:1,type:'in',date:'2026-12-01',grams:4000,cost_kg:100},
 {id:7,lot_id:2,type:'out',date:'2026-11-15',grams:2,cost_kg:500,reason:'Uso'},
 ];
 const all=monthlyMovementDetails(movements,lots,'2026-11');
 assert.deepEqual(all.in.map(m=>m.id),[2,4]);assert.deepEqual(all.out.map(m=>m.id),[7,3]);
 assert.equal(all.in[0].value,400);assert.equal(all.out[0].value,1000);assert.equal(all.out[0].unit,'pzas');
 const filtered=monthlyMovementDetails(movements,lots,'2026-11',[1]);assert.deepEqual(filtered.out.map(m=>m.id),[3]);assert.equal(filtered.out[0].lot,'L1');assert.equal(filtered.out[0].value,25);
 assert.deepEqual(monthlyMovementDetails(movements,lots,'2026-11',[]),{in:[],out:[]});
});
test('monthly PDF keeps summary, income and expenses in one document with continuous page numbers',()=>{
 const columns=[{label:'Fecha',width:100},{label:'Motivo',width:678}];
 const bytes=createTablePDF({title:'Resumen mensual',columns,rows:[['2026-11-01','Existencia inicial']],sections:[
 {title:'Ingresos del mes',columns,rows:Array.from({length:50},(_,i)=>['2026-11-04','Compra '+i])},
 {title:'Egresos del mes',columns,rows:[],emptyMessage:'No se registraron egresos.'}
 ]});
 const pdf=Buffer.from(bytes).toString('latin1');
 for(const t of ['Resumen mensual','Ingresos del mes','Egresos del mes','Compra 49','No se registraron egresos.'])assert.ok(pdf.includes(t),t);
 const pages=Number(pdf.match(/\/Count (\d+)/)[1]);assert.ok(pages>=4);assert.ok(pdf.includes(`Página ${pages} de ${pages}`));assert.ok(pdf.includes('51 registros'));
});
