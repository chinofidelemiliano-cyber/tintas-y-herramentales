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
test('PDF uses chosen site name and English pagination without returning removed branding',()=>{
 const bytes=createTablePDF({title:'Inventory',columns:[{label:'Batch',width:778}],rows:[['79091']],brand:'Mi taller',language:'en'});const pdf=Buffer.from(bytes).toString('latin1');assert.ok(pdf.includes('(Mi taller)'));assert.ok(pdf.includes('Page 1 of 1'));assert.ok(!/prisma|identilabel/i.test(pdf));
});
