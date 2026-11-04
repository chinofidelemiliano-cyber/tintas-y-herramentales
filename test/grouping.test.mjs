import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalCode,splitContainers,groupLots} from '../public/inventory-model.js';
const seed=JSON.parse(readFileSync(new URL('../data/seed.json',import.meta.url)));
const catalog=JSON.parse(readFileSync(new URL('../public/catalog.json',import.meta.url)));
test('uploaded catalog has 75 unique codes and every original lot has a matching product',()=>{
 assert.equal(catalog.length,75);assert.equal(new Set(catalog.map(p=>p.code)).size,75);
 for(const l of seed)assert.ok(catalog.some(p=>p.code===canonicalCode(l.code)),l.code);
 const p=catalog.find(p=>p.code==='E3024P01');assert.equal(p.maximum,16000);assert.equal(p.minimum,4000);assert.equal(p.cost_kg,205);
 assert.equal(catalog.find(p=>p.code==='BLF105').name,'Cian Film');assert.equal(catalog.find(p=>p.code==='BLF105').kind,'Film');
});
test('same-code lots stay separate within one group with unchanged totals',()=>{
 const groups=groupLots(seed);assert.equal(groups.length,65);assert.equal(groups.reduce((s,g)=>s+g.grams,0),324741);
 const yellow=groups.find(g=>g.code==='E3024P01');assert.equal(yellow.lots.length,2);assert.equal(yellow.grams,9053);
 assert.deepEqual(yellow.lots.map(l=>l.lot),['79091','77215']);assert.equal(canonicalCode(' flmami-162 '),'FLMAMI-162');
 assert.equal(canonicalCode('UIAPP50EP021ID'),'APP50EP021ID');
});
test('4kg containers retain balances exactly including partials, empty and negative lots',()=>{
 assert.deepEqual(splitContainers(7041).map(c=>c.grams),[4000,3041]);assert.deepEqual(splitContainers(8000).map(c=>c.grams),[4000,4000]);
 assert.deepEqual(splitContainers(321).map(c=>c.grams),[321]);assert.deepEqual(splitContainers(0),[]);assert.deepEqual(splitContainers(-3374),[]);
 for(const l of seed.filter(l=>l.grams>0)){const cs=splitContainers(l.grams);assert.equal(cs.reduce((s,c)=>s+c.grams,0),l.grams);assert.ok(cs.every(c=>c.grams<=4000&&c.grams>0&&c.estimated))}
 assert.equal(splitContainers(4000.001).reduce((s,c)=>s+c.grams,0),4000.001);
});
test('supplier dropdown groups retain every code, lot and balance without a display cap',async()=>{
 const {groupByProvider}=await import('../public/inventory-model.js');
 const products=new Map(catalog.map(p=>[p.code,p]));
 const lots=seed.map(l=>({...l,provider:products.get(canonicalCode(l.code)).provider,code:canonicalCode(l.code)}));
 const providers=groupByProvider(lots);
 assert.equal(providers.length,7);
 assert.equal(providers.flatMap(p=>p.groups).length,65);
 assert.equal(providers.flatMap(p=>p.lots).length,88);
 assert.equal(providers.reduce((sum,p)=>sum+p.grams,0),324741);
 assert.equal(providers.find(p=>p.name==='Graphic').groups.find(g=>g.code==='E3024P01').lots.length,2);
 assert.equal(groupByProvider([{...lots[0],provider:' Inkolor '},{...lots[1],provider:'inkolor'}]).length,1);
});
