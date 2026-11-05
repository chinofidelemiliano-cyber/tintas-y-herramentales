import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePDFStyle,logoLayout,mmToPoints,pdfColor} from '../public/pdf-style.js';
import {createTablePDF} from '../public/pdf-report.js';
import {createIncidentPDF} from '../public/incident-report.js';
test('PDF style validates colors, fonts and sizes and preserves logo aspect ratio',()=>{
 const style=normalizePDFStyle({logoWidth:80,logoAlign:'left',fontFamily:'mono',fontSize:99,titleColor:'url(bad)'});
 assert.equal(style.fontSize,11);assert.equal(style.titleColor,'#24344f');assert.equal(style.fontFamily,'mono');
 const a=logoLayout({width:1287,height:221},842,style),b=logoLayout({width:1287,height:221},842,{...style,logoWidth:160});
 assert.ok(Math.abs(a.width-mmToPoints(80))<0.01);assert.ok(Math.abs(b.width/a.width-2)<0.01);assert.ok(Math.abs(a.width/a.height-1287/221)<0.001);assert.equal(a.x,mmToPoints(style.margin));assert.equal(pdfColor('#ff0000'),'1.0000 0.0000 0.0000');
});
test('default report contains only title and data without site name or explanatory text',()=>{
 const pdf=Buffer.from(createTablePDF({title:'Existencias',brand:'Mi inventario',subtitle:'Mi inventario · Emitido el 04/11/2026',notes:['NOTA EXPLICATIVA'],columns:[{label:'Lote',width:778}],rows:[['79091']],summary:'Total 1 lote'})).toString('latin1');
 assert.ok(!pdf.includes('Mi inventario'));assert.ok(!pdf.includes('NOTA EXPLICATIVA'));assert.ok(!pdf.includes('Emitido el'));assert.ok(pdf.includes('79091'));assert.ok(pdf.includes('Total 1 lote'));
});
test('custom colors, typography and optional report contents render without losing records',()=>{
 const pdf=Buffer.from(createTablePDF({title:'Existencias',subtitle:'FECHA DE EMISIÓN',notes:['NOTA EXPLICATIVA'],columns:[{label:'Código',width:300},{label:'Notas',width:478}],rows:Array.from({length:80},(_,i)=>['ROW-'+i,'Texto largo con espacios para comprobar ajuste de columnas y saltos de página']),pdfStyle:{fontFamily:'mono',fontSize:11,headerColor:'#ff0000',headerTextColor:'#ffffff',showNotes:true,showIssuedDate:true,showPageNumbers:false}})).toString('latin1');
 assert.ok(pdf.includes('/BaseFont /Courier'));assert.ok(pdf.includes('1.0000 0.0000 0.0000 rg'));assert.ok(pdf.includes('FECHA DE EMISIÓN'));assert.ok(pdf.includes('NOTA EXPLICATIVA'));for(let i=0;i<80;i++)assert.ok(pdf.includes('(ROW-'+i+')'));assert.ok(!pdf.includes('Página'));
 const record={folio:'INC-0011',date:'2026-11-04',order_ref:'OP-1',machine:'Comco 2',responsible:'Producción',description:'Incidencia',action:'Corregida',impact:'Paro',status:'Cerrada'};
 const incident=Buffer.from(createIncidentPDF(record,{siteName:'Mi inventario',pdfStyle:{fontFamily:'serif',headerColor:'#ff0000'}})).toString('latin1');assert.ok(!incident.includes('Mi inventario'));assert.ok(incident.includes('/BaseFont /Times-Roman'));assert.ok(incident.includes('1.0000 0.0000 0.0000 rg'));
});

test('white or low-contrast saved text stays readable on printed reports',async()=>{
 const {readablePDFStyle}=await import('../public/pdf-style.js');const style=readablePDFStyle({textColor:'#ffffff',titleColor:'#ffffff',headerColor:'#ffffff',headerTextColor:'#ffffff',stripeColor:'#111111'});
 assert.equal(style.textColor,'#111111');assert.equal(style.titleColor,'#111111');assert.equal(style.headerTextColor,'#111111');assert.equal(style.stripeColor,'#f5f5f5');
 const pdf=Buffer.from(createTablePDF({title:'Inventario',columns:[{label:'Código',width:778}],rows:[['LOTE-VISIBLE']],pdfStyle:{textColor:'#ffffff'}})).toString('latin1');assert.match(pdf,/0\.0667 0\.0667 0\.0667 rg[^\n]*\(LOTE-VISIBLE\) Tj/);
});
test('incident comparison automatically uses saved defect and corrective action',()=>{
 const pdf=Buffer.from(createIncidentPDF({folio:'INC-0011',date:'2026-11-05',order_ref:'OP-107',np:'332',machine:'Comco 2',prepared_by:'Emiliano',responsible:'Producción',description:'Mancha visible',action:'Cambio de placa',impact:'Paro',status:'Cerrada'})).toString('latin1');
 assert.equal((pdf.match(/\(Mancha visible\) Tj/g)||[]).length,2);assert.equal((pdf.match(/\(Cambio de placa\) Tj/g)||[]).length,2);assert.ok(pdf.includes('(Emiliano)'));assert.ok(pdf.includes('/Count 2'));
});
