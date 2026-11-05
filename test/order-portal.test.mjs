import {test} from 'node:test';import assert from 'node:assert/strict';import {normalizePortalOrder} from '../public/order-portal-model.js';
const order={folio:'OP-1',np:'016-1',product:'Prueba',pressman:'Operador',machine:'Mark Andy',colors:'Negro',scheduled_date:'2026-11-06',scheduled_start:'08:30'};
test('shared order input validates dates, machines, times and quantities',()=>{
 const result=normalizePortalOrder({...order,folio:' OP-1 ',pieces:'1200000',meters:'12725.5'});assert.equal(result.folio,'OP-1');assert.equal(result.pieces,1200000);assert.equal(result.meters,12725.5);assert.equal(result.scheduled_end,'');assert.equal(result.client,'');
 for(const value of [{machine:'Otra'},{scheduled_date:'2026-02-31'},{scheduled_start:'25:00'},{pieces:-1},{meters:'NaN'},{colors:''}])assert.throws(()=>normalizePortalOrder({...order,...value}));
});
