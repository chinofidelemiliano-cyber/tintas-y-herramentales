import test from 'node:test';
import assert from 'node:assert/strict';
import {inkRecommendations} from '../public/plant-controls.js';

test('suggests ABC by accumulated demand and lets indispensable inks stay in A',()=>{
 const defaults={lead_days:7,review_days:14,safety_days:3,on_hand:0,indispensable:false};
 const records=[
  {...defaults,code:'B',consumed:15000},
  {...defaults,code:'A',consumed:80000,on_hand:100000},
  {...defaults,code:'C',consumed:5000},
  {...defaults,code:'CRIT',consumed:0,indispensable:true}
 ];
 const [a,b,c,critical]=inkRecommendations(records,10);
 assert.deepEqual([a.suggestion,b.suggestion,c.suggestion,critical.suggestion],['A','B','C','A']);
 assert.equal(a.minimum,80000);
 assert.equal(a.middle,136000);
 assert.equal(a.maximum,192000);
 assert.equal(a.alert,false);
 assert.equal(b.alert,true);
 assert.equal(critical.alert,false);
});

test('draft groups purchases by supplier and leaves the quantity in kilograms',async()=>{
 const {supplyEmail}=await import('../public/plant-controls.js');
 const draft=supplyEmail([
  {code:'A1',name:'Amarillo',provider:'Proveedor 1',kg:4},
  {code:'B1',name:'Negro',provider:'Proveedor 1',kg:8.5},
  {code:'C1',name:'Azul',kg:2}
 ]);
 assert.match(draft.body,/Buen día, Maribel/);
 assert.match(draft.body,/Amarillo \(A1\): 4 kg/);
 assert.match(draft.body,/Negro \(B1\): 8.5 kg/);
 assert.equal(draft.body.match(/Proveedor 1/g).length,1);
 assert.match(draft.body,/Azul \(C1\): 2 kg/);
});
