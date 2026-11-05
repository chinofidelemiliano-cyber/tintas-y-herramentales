import {test} from 'node:test';import assert from 'node:assert/strict';import {dieUsage} from '../public/die-usage.js';
const run=(id,meters,status='confirmed',specifications={suaje:'SJ059-1 · Suaje'})=>({id,folio:'OP-'+id,status,specifications,lines:meters.map(meters=>({meters}))});
test('die metres count each closed order once, preserve fractions and exclude drafts and cancellations',()=>{
 const {groups,pending}=dieUsage([run(1,[1200.125,1200.125,1200.125]),run(2,[.875,.875]),run(3,[50],'draft'),run(4,[100],'cancelled')]);assert.equal(groups.length,1);assert.equal(groups[0].code,'SJ059-1');assert.equal(groups[0].meters,1201);assert.equal(groups[0].runs.length,2);assert.equal(pending.length,0);
});
test('missing die, missing or inconsistent actual metres stay visible for review without guessed sums',()=>{
 const {groups,pending}=dieUsage([run(1,[null,null]),run(2,[20,30]),run(3,[10],'confirmed',{}),run(4,[0,0])]);assert.equal(groups[0].meters,0);assert.equal(groups[0].runs.length,1);assert.equal(pending.length,3);
});
test('uses the related SJ catalogue ID and never counts a PD code as a die',()=>{
 const result=dieUsage([run(1,[15],'confirmed',{die_id:5}),run(2,[30],'confirmed',{suaje:'PD003-1'})],[{id:5,category:'herramental',code:'SJ001-1',name:'Suaje'}]);assert.equal(result.groups[0].code,'SJ001-1');assert.equal(result.groups[0].meters,15);assert.equal(result.pending.length,1);
});
