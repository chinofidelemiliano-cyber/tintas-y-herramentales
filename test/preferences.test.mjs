import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePreferences,defaults,formatDisplayDate} from '../public/preferences.js';
import {translate} from '../public/translations.js';
import {createTablePDF} from '../public/pdf-report.js';
test('preferences keep only supported values and cannot affect inventory units or currency',()=>{
 const p=normalizePreferences({language:'en',theme:'dark',siteName:'  Mi taller  ',accent:'blue',density:'compact',dateFormat:'dmy',expandInventory:false,currency:'USD',containerSize:1});
 assert.equal(p.siteName,'Mi taller');assert.equal(p.language,'en');assert.equal(p.theme,'dark');assert.equal(p.expandInventory,false);assert.equal(p.currency,undefined);assert.equal(p.containerSize,undefined);
 assert.deepEqual(normalizePreferences(null),defaults);assert.equal(normalizePreferences({accent:'url(evil)',language:'invalid'}).accent,'green');
});
test('date format selection is independent of stock dates and uses chosen language',()=>{
 assert.equal(formatDisplayDate('2026-11-04',{...defaults,dateFormat:'dmy'}),'04/11/2026');assert.equal(formatDisplayDate('2026-11-04',{...defaults,dateFormat:'mdy'}),'11/04/2026');assert.equal(formatDisplayDate('2026-11-04',{...defaults,dateFormat:'iso'}),'2026-11-04');assert.match(formatDisplayDate('2026-11-04',{...defaults,language:'en'}),/Nov/);
 assert.equal(translate('Configuración','en'),'Settings');assert.equal(translate('Configuración','es'),'Configuración');assert.equal(translate('Amarillo Process','en'),'Amarillo Process');
});
test('PDF uses English pagination without printing site names or removed branding',()=>{
 const bytes=createTablePDF({title:'Inventory',columns:[{label:'Batch',width:778}],rows:[['79091']],brand:'Mi taller',language:'en'});const pdf=Buffer.from(bytes).toString('latin1');assert.ok(!pdf.includes('Mi taller'));assert.ok(pdf.includes('Page 1 of 1'));assert.ok(!/prisma|identilabel/i.test(pdf));
});
test('report logo setting accepts only valid compact JPEG images',async()=>{
 const {readFileSync}=await import('node:fs');const logo='data:image/jpeg;base64,'+readFileSync(new URL('./fixtures/before.jpg',import.meta.url)).toString('base64');
 assert.equal(normalizePreferences({reportLogo:logo}).reportLogo,logo);assert.equal(normalizePreferences({reportLogo:'https://example.invalid/logo.svg'}).reportLogo,null);
 const pdf=Buffer.from(createTablePDF({title:'Inventory',columns:[{label:'Batch',width:778}],rows:Array.from({length:80},(_,i)=>[String(i)]),logo})).toString('latin1');
 const pages=Number(pdf.match(/\/Count (\d+)/)[1]);assert.ok(pages>1);assert.equal((pdf.match(/\/ReportLogo Do/g)||[]).length,pages);assert.equal((pdf.match(/\/Subtype \/Image/g)||[]).length,1);
});
test('profile preferences travel between devices, import once and stay separated by account',async t=>{
 const previous=globalThis.localStorage;let storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};t.after(()=>{globalThis.localStorage=previous;});
 const {savePreferences,readPreferences,loadProfilePreferences}=await import('../public/preferences.js');
 const profiles=new Map();let user='A';const cloud={userId:()=>user,preferences:async()=>profiles.get(user)??null,savePreferences:async(value,initial)=>{if(!initial||!profiles.has(user))profiles.set(user,value);return profiles.get(user);}};
 savePreferences({...defaults,theme:'dark',siteName:'Mi taller',pdfStyle:{fontSize:11}});
 const imported=await loadProfilePreferences(cloud);assert.equal(imported.siteName,'Mi taller');assert.equal(imported.pdfStyle.fontSize,11);
 user='B';assert.equal((await loadProfilePreferences(cloud)).siteName,defaults.siteName);assert.equal(readPreferences('A').theme,'dark');
 storage=new Map();user='A';assert.equal((await loadProfilePreferences(cloud)).theme,'dark');assert.equal(readPreferences('A').siteName,'Mi taller');
 // A newer remote profile wins over a stale local cache.
 profiles.set('A',{...defaults,accent:'purple'});assert.equal((await loadProfilePreferences(cloud)).accent,'purple');
 cloud.preferences=async()=>{throw Error('sin conexión');};await assert.rejects(loadProfilePreferences(cloud),/sin conexión/);assert.equal(readPreferences('A').accent,'purple');
});
test('simultaneous first login does not overwrite a profile saved by another device',async()=>{
 const {loadProfilePreferences}=await import('../public/preferences.js');
 const cloud={userId:()=> 'race',preferences:async()=>null,savePreferences:async(value,initial)=>{assert.equal(initial,true);return {...defaults,siteName:'Otro dispositivo'};}};
 assert.equal((await loadProfilePreferences(cloud)).siteName,'Otro dispositivo');
});
