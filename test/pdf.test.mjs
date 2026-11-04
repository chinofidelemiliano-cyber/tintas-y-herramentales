import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTablePDF} from '../public/pdf-report.js';
test('PDF has valid byte offsets, Spanish text, multiple pages and every input row',()=>{
 const rows=Array.from({length:100},(_,i)=>['Lote-'+i,'Tinta áéíóú Ñ (especial) \\ prueba',i]);
 const bytes=createTablePDF({title:'Inventario por proveedor',notes:['Distribución estimada · 4,000 g más sobrante.'],columns:[{label:'Lote',width:100},{label:'Descripción',width:500},{label:'Gramos',width:178}],rows,summary:'100 lotes exportados'});
 const pdf=Buffer.from(bytes).toString('latin1');
 assert.ok(pdf.startsWith('%PDF-1.4'));assert.match(pdf,/%%EOF\n$/);
 const xref=Number(pdf.match(/startxref\n(\d+)/)[1]);assert.equal(pdf.slice(xref,xref+4),'xref');
 const offsets=pdf.slice(xref).split('\n').filter(l=>/^\d{10} 00000 n/.test(l)).map(l=>Number(l.slice(0,10)));
 offsets.forEach((o,i)=>assert.ok(pdf.slice(o).startsWith(`${i+1} 0 obj`)));
 assert.ok(Number(pdf.match(/\/Count (\d+)/)[1])>1);
 for(let i=0;i<100;i++)assert.ok(pdf.includes(`(Lote-${i})`));
 assert.ok(pdf.includes('áéíóú Ñ \\(especial\\) \\\\ prueba'));
});
