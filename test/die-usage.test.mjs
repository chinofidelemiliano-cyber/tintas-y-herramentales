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

test('plecas accumulate actual metres once per closed order and remain independent from suajes',async()=>{
 const {creaseUsage}=await import('../public/die-usage.js');
 const orders=[run(1,[123.125,123.125],'confirmed',{suaje:'SJ059-1',pleca:'PD003-1 · Pleca'}),run(2,[.875],'confirmed',{crease_id:8}),run(3,[500],'draft',{pleca:'PD003-1'}),run(4,[500],'cancelled',{pleca:'PD003-1'}),run(5,[null],'confirmed',{pleca:'PD003-1'}),run(6,[20,30],'confirmed',{pleca:'PD003-1'}),run(7,[10],'confirmed',{pleca:'SJ001-1'})];
 const result=creaseUsage(orders,[{id:8,category:'herramental',code:'PD003-1',name:'Pleca'}]);assert.equal(result.groups.length,1);assert.equal(result.groups[0].code,'PD003-1');assert.equal(result.groups[0].meters,124);assert.equal(result.groups[0].runs.length,2);assert.equal(result.pending.length,3);assert.match(result.pending[2].reason,/Sin pleca PD/);
 assert.equal(dieUsage(orders).groups[0].code,'SJ059-1');assert.equal(dieUsage(orders).groups[0].meters,123.125);
});
