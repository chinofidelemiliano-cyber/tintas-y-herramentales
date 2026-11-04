import {test} from 'node:test';
import assert from 'node:assert/strict';
import {incidentMachines,incidentOwners,incidentFolio} from '../public/incident-model.js';
import {createIncidentPDF} from '../public/incident-report.js';
test('incident options match requested machines and owners, folios start at 11',()=>{
 assert.deepEqual(incidentMachines,['Mark Andy','Comco 1','Comco 2','Maquina China']);assert.deepEqual(incidentOwners,['Diseño','Producción','Preprensa','Proveedor','Mantenimiento','Compartida']);assert.equal(incidentFolio(11),'INC-0011');assert.equal(incidentFolio(10000),'INC-10000');
});
test('individual portrait PDF contains evidence form, comparison, signatures and full incident detail',()=>{
 const long='DETALLE-COMPLETO '.repeat(600)+'FINAL-DE-DESCRIPCION';
 const record={folio:'INC-0011',date:'2026-11-04',order_ref:'OP-2026-00102',np:'014-1',machine:'Comco 2',responsible:'Producción',prepared_by:'Calidad',description:long,action:'Se ajustó el anilox.',impact:'Paro',status:'Cerrada',color_observed:'Azul',test_result:'Aprobado',validation_notes:'Validación completa'};
 const pdf=Buffer.from(createIncidentPDF(record,{siteName:'Mi inventario'})).toString('latin1');
 for(const label of ['INC-0011','ANTES','DESPUÉS','Color observado','Resultado de la prueba','Preprensa','Calidad','Encargado de producción','FINAL-DE-DESCRIPCION','Se ajustó el anilox.'])assert.ok(pdf.includes(label),label);
 assert.ok(pdf.includes('/MediaBox [0 0 595 842]'));assert.equal(Number(pdf.match(/\/Count (\d+)/)[1]),2);assert.ok(!/identilabel|prisma/i.test(pdf));
});
