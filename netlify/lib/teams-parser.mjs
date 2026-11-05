const plain=value=>String(value).replace(/<br\s*\/?\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi,e=>{const named={'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"};if(named[e.toLowerCase()])return named[e.toLowerCase()];const code=e[2].toLowerCase()==='x'?parseInt(e.slice(3),16):parseInt(e.slice(2),10);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/\s+/g,' ').trim();
const normal=value=>plain(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const quantity=value=>{if(!value)return null;const v=value.replace(/\s/g,'');if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(v))throw Error('Cantidad ambigua: '+value);const n=Number(v.replaceAll(',',''));if(!Number.isFinite(n)||n<0||n>1e12)throw Error('Cantidad fuera de rango.');return n;};
function tableRows(html){
 const rows=[];let rowIndex=0;
 for(const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const output=rows[rowIndex]||=[];let col=0;
  for(const cell of row[1].matchAll(/<(?:td|th)\b([^>]*)>([\s\S]*?)<\/(?:td|th)>/gi)){
   while(output[col]!==undefined)col++;
   const span=name=>Math.min(20,Math.max(1,Number(cell[1].match(new RegExp(name+'\\s*=\\s*["\\\']?(\\d+)','i'))?.[1])||1));
   const cols=span('colspan'),rs=span('rowspan'),text=plain(cell[2]);
   for(let r=0;r<rs;r++){const target=rows[rowIndex+r]||=[];for(let c=0;c<cols;c++)target[col+c]=text;}col+=cols;
  }rowIndex++;
 }return rows;
}
function parseDate(value){if(!value)return null;const m=value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(!m)throw Error('La fecha debe usar día/mes/año.');const iso=`${m[3]}-${m[2]}-${m[1]}`;if(!Number.isFinite(Date.parse(iso))||new Date(iso).toISOString().slice(0,10)!==iso)throw Error('Fecha no válida.');return iso;}
const time=value=>{if(!value)return null;if(!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value))throw Error('Hora no válida. Usa HH:mm.');return value.slice(0,5);};
export function parseTeamsOrders(html){
 if(typeof html!=='string'||html.length>200000)throw Error('Mensaje vacío o demasiado grande.');
 const orders=[];
 for(const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)){
  const rows=tableRows(table[1]);const headerIndex=rows.findIndex(row=>row.some(c=>normal(c)==='ordendeproduccion'));
  if(headerIndex<0)continue;
  const headers=rows[headerIndex].map(normal),values=rows[headerIndex+1]||[];
  const field=names=>values[headers.findIndex(h=>names.includes(h))]||'';
  const folio=field(['ordendeproduccion']),np=field(['numerodeparte','np']),product=field(['descripciondelproducto','producto']);
  if(!/^OP-[A-Z0-9-]+$/i.test(folio)||!np||!product)throw Error('La tabla necesita orden OP, número de parte y descripción del producto.');
  let scheduledDate=null,scheduledStart=null,scheduledEnd=null;
  for(const row of rows.slice(0,headerIndex))for(let i=0;i<row.length;i++){
   const label=normal(row[i]);let next=i+1;while(next<row.length&&normal(row[next])===label)next++;
   if(label==='fecha')scheduledDate=parseDate(row[next]);if(label==='horainicio')scheduledStart=time(row[next]);if(['horatermino','horafin'].includes(label))scheduledEnd=time(row[next]);
  }
  const specs={};const detailIndex=rows.findIndex((row,i)=>i>headerIndex+1&&row.some(c=>normal(c)==='suaje'));
  if(detailIndex>=0){const keys=rows[detailIndex].map(normal);for(const key of ['suaje','pasodesuaje','pasodesarrollo','pleca','th','uv','colores','pantone']){const index=keys.indexOf(key);if(index>=0)specs[key]=[...new Set(rows.slice(detailIndex+1).map(row=>row[index]||'').filter(Boolean))].join(' · ');}}
  orders.push({folio:folio.toUpperCase(),np,product,client:field(['cliente']),pieces:quantity(field(['cantidaddepiezas'])),meters:quantity(field(['cantidaddemts','cantidademetros','cantidaddemetros'])),scheduled_date:scheduledDate,scheduled_start:scheduledStart,scheduled_end:scheduledEnd,specifications:specs});
 }
 if(!orders.length)throw Error('No se encontró una tabla de orden. Las fotografías requieren OCR; envía la tabla como texto de Teams.');
 if(orders.length>10)throw Error('Máximo 10 órdenes por mensaje.');return orders;
}
