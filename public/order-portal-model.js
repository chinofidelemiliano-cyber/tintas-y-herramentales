import {incidentMachines} from './incident-model.js';
export function normalizePortalOrder(value){
 const text=(key,label,max,optional=false)=>{const result=typeof value?.[key]==='string'?value[key].trim():'';if((!optional&&!result)||result.length>max)throw Error('Revisa '+label+'.');return result;};
 const result={folio:text('folio','la orden',100),np:text('np','el NP',100),product:text('product','el producto',150),client:text('client','el cliente',150,true),pressman:text('pressman','el prensista',100),machine:text('machine','la máquina',40),colors:text('colors','los colores',2000,Array.isArray(value?.ink_selections)&&value.ink_selections.length>0),scheduled_date:text('scheduled_date','la fecha programada',10),scheduled_start:text('scheduled_start','la hora de inicio',5),scheduled_end:text('scheduled_end','la hora de término',5,true),notes:text('notes','las notas',1000,true)};
 if(value?.ink_family!==undefined){if(!['Base Agua','UV'].includes(value.ink_family))throw Error('Selecciona Base Agua o UV.');result.ink_family=value.ink_family;}
 if(!incidentMachines.includes(result.machine))throw Error('Selecciona una máquina válida.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(result.scheduled_date)||!Number.isFinite(Date.parse(result.scheduled_date))||new Date(result.scheduled_date).toISOString().slice(0,10)!==result.scheduled_date)throw Error('Fecha no válida.');
 for(const key of ['scheduled_start','scheduled_end'])if(result[key]&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(result[key]))throw Error('Hora no válida.');
 for(const key of ['pieces','meters']){if(value?.[key]===''||value?.[key]==null)result[key]=null;else{const n=Number(value[key]);if(!Number.isFinite(n)||n<0||n>1e12)throw Error('Cantidad no válida.');result[key]=n;}}
 if(value?.ink_selections!==undefined){
  if(!Array.isArray(value.ink_selections)||value.ink_selections.length>(result.machine.startsWith('Comco')?6:12))throw Error('Demasiadas posiciones de color.');
  const seen=new Set();result.ink_selections=value.ink_selections.map(i=>{if(i.custom_id){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(i.custom_id))throw Error('Tinta personalizada no válida.');}
  if(i.ink_family!==undefined&&!['Base Agua','UV'].includes(i.ink_family))throw Error('Selecciona Base Agua o UV en cada tinta utilizada.');
  const slot=Number(i.slot),product_id=i.product_id==null?null:Number(i.product_id),pantone=String(i.pantone||'').trim();if(!Number.isInteger(slot)||slot<1||slot>(result.machine.startsWith('Comco')?6:12)||seen.has(slot)||((product_id!==null)===(pantone!==''))||(product_id!==null&&(!Number.isSafeInteger(product_id)||product_id<=0))||pantone.length>100)throw Error('Revisa las posiciones de tinta / Pantone.');seen.add(slot);return {slot,product_id,pantone,...(i.ink_family?{ink_family:i.ink_family}:{}),...(i.custom_id?{custom_id:i.custom_id}:{})};});
  if(!result.ink_selections.length&&!result.colors)throw Error('Selecciona al menos un color.');
 }
 for(const key of ['die_id','crease_id']){const id=value?.[key];if(id!==undefined){result[key]=id===''||id==null?null:Number(id);if(result[key]!==null&&(!Number.isSafeInteger(result[key])||result[key]<=0))throw Error('Herramental no válido.');}}
 return result;
}
