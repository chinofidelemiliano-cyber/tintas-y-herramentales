export const incidentMachines=['Mark Andy','Comco 1','Comco 2','Maquina China'];
export const incidentOwners=['Diseño','Producción','Preprensa','Proveedor','Mantenimiento','Compartida'];
export const incidentImpacts=['Merma','Paro','Retrabajo','Calidad','Entrega','Otro'];
export const incidentStatuses=['Abierta','En seguimiento','Cerrada'];
export const incidentFolio=number=>'INC-'+String(number).padStart(4,'0');

export function incidentNPs(order){return [...new Set([order?.np,...(order?.lines||[]).map(line=>line.np)].filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()))];}
