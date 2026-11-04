import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {jpegPhoto,incidentClock,incidentSeconds} from '../public/incident-photos.js';
import {createIncidentPDF} from '../public/incident-report.js';
const photo='data:image/jpeg;base64,'+readFileSync(new URL('./fixtures/before.jpg',import.meta.url)).toString('base64');
test('photos validate JPEG data, dimensions, size and timer timestamps',()=>{
 const parsed=jpegPhoto(photo);assert.equal(parsed.width,320);assert.equal(parsed.height,200);assert.equal(parsed.components,3);
 assert.throws(()=>jpegPhoto('data:image/svg+xml;base64,AAAA'));assert.throws(()=>jpegPhoto('data:image/jpeg;base64,AAAA'));
 assert.equal(incidentSeconds({started_at:'2026-11-04T10:00:00Z'},Date.parse('2026-11-04T10:01:15Z')),75);assert.equal(incidentClock(75),'00:01:15');assert.equal(incidentSeconds({started_at:'2026-11-04T10:00:00Z',ended_at:'2026-11-04T10:02:00Z'},Date.now()),120);
});
test('report embeds both JPEG photographs as PDF image objects with elapsed time',()=>{
 const record={folio:'INC-0011',date:'2026-11-04',order_ref:'OP-1',np:'NP1',machine:'Comco 2',responsible:'Producción',description:'Defecto',action:'Corregido',status:'Cerrada',impact:'Paro',before_photo:photo,after_photo:photo,started_at:'2026-11-04T10:00:00Z',ended_at:'2026-11-04T10:02:00Z'};
 const pdf=Buffer.from(createIncidentPDF(record)).toString('latin1');assert.equal((pdf.match(/\/Subtype \/Image/g)||[]).length,2);assert.ok(pdf.includes('/Before '));assert.ok(pdf.includes('/After '));assert.ok(pdf.includes('/DCTDecode'));assert.ok(pdf.includes('00:02:00'));
});
