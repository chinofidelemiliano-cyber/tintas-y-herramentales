export const inkFamilies=['Base Agua','UV'];
export function inkFamily(kind){const value=String(kind||'').trim().toLowerCase();return value==='uv'?'UV':/^(base\s*agua|base\s*de\s*agua|agua)$/.test(value)?'Base Agua':null;}
export function normalizeInkOptions(value){
 if(!Array.isArray(value)||value.length>100)throw Error('Puedes configurar hasta 100 tintas personalizadas.');const seen=new Set();return value.map(row=>{const id=String(row.id||''),label=String(row.label||'').trim(),family=row.family,product_id=row.product_id===''||row.product_id==null?null:Number(row.product_id);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||seen.has(id)||!label||label.length>80||!inkFamilies.includes(family)||(product_id!==null&&(!Number.isSafeInteger(product_id)||product_id<=0)))throw Error('Revisa el nombre, tipo y producto de cada tinta personalizada.');seen.add(id);return {id,label,family,product_id};});
}
export function resolveOrderInks(order,options,products){
 if(order.ink_family!==undefined&&!inkFamilies.includes(order.ink_family))throw Error('Selecciona Base Agua o UV.');
 const custom=normalizeInkOptions(options||[]);return {...order,ink_selections:(order.ink_selections||[]).map(item=>{let result={...item};if(item.custom_id){const option=custom.find(o=>o.id===item.custom_id&&o.family===order.ink_family);if(!option)throw Error('La tinta personalizada cambió. Actualiza el catálogo.');result={slot:item.slot,product_id:option.product_id,pantone:option.product_id?'':option.label+' ('+option.family+')'};}if(result.product_id){const p=products.find(p=>p.id===Number(result.product_id));if(!p||p.category!=='tinta'||(order.ink_family&&inkFamily(p.kind)!==order.ink_family))throw Error('La tinta no corresponde al tipo seleccionado.');}return result;})};
}
