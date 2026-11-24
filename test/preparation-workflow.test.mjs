import test from 'node:test';
import assert from 'node:assert/strict';
import {preparationTiming} from '../public/preparation-workflow.js';

const started_at='2026-11-24T15:00:00.000Z';
const at=minutes=>new Date(Date.parse(started_at)+minutes*60_000).toISOString();

test('a persisted pause holds effective time while elapsed time advances',()=>{
 const clock={paused_at:at(12),paused_seconds:120};
 const timing=preparationTiming({started_at},clock,Date.parse(at(37)));
 assert.deepEqual(timing,{elapsed:2220,paused:1620,effective:600,idle:0});
});

test('a corrected preparation uses its corrected interval and allocation without mutating the order',()=>{
 const order={started_at,ended_at:at(60)};
 const clock={paused_seconds:600,correction:{started_at:at(1),ended_at:at(21),effective_seconds:900,paused_seconds:180,idle_seconds:120}};
 assert.deepEqual(preparationTiming(order,clock),{elapsed:1200,paused:180,effective:900,idle:120});
 assert.equal(order.ended_at,at(60));
 assert.equal(preparationTiming(order).effective,3600);
});

test('pause, shortages and partial checklist completion show distinct states',async()=>{
 const {preparationState}=await import('../public/preparation-workflow.js');
 const order={started_at};
 assert.equal(preparationState(order,{paused_at:at(1)}),'En pausa');
 assert.equal(preparationState(order,{items:[{status:'unavailable'}]}),'En espera de materiales');
 assert.equal(preparationState(order,{items:[{status:'ready'},{status:'pending'}]}),'Preparación parcial');
 assert.equal(preparationState({...order,status:'cancelled'},{closed_at:at(2)}),'Cancelada');
});
