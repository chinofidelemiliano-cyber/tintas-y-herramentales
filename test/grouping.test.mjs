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
