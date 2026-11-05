import {incidentMachines} from './incident-model.js';
export function normalizePortalOrder(value){
 const text=(key,label,max,optional=false)=>{const result=typeof value?.[key]==='string'?value[key].trim():'';if((!optional&&!result)||result.length>max)throw Error('Revisa '+label+'.');return result;};
 const result={folio:text('folio','la orden',100),np:text('np','el NP',100),product:text('product','el producto',150),client:text('client','el cliente',150,true),pressman:text('pressman','el prensista',100),machine:text('machine','la máquina',40),colors:text('colors','los colores',1000),scheduled_date:text('scheduled_date','la fecha programada',10),scheduled_start:text('scheduled_start','la hora de inicio',5),scheduled_end:text('scheduled_end','la hora de término',5,true),notes:text('notes','las notas',1000,true)};
 if(!incidentMachines.includes(result.machine))throw Error('Selecciona una máquina válida.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(result.scheduled_date)||!Number.isFinite(Date.parse(result.scheduled_date))||new Date(result.scheduled_date).toISOString().slice(0,10)!==result.scheduled_date)throw Error('Fecha no válida.');
 for(const key of ['scheduled_start','scheduled_end'])if(result[key]&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(result[key]))throw Error('Hora no válida.');
 for(const key of ['pieces','meters']){if(value?.[key]===''||value?.[key]==null)result[key]=null;else{const n=Number(value[key]);if(!Number.isFinite(n)||n<0||n>1e12)throw Error('Cantidad no válida.');result[key]=n;}}
 return result;
}
