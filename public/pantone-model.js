export function mixtureRecipe(value){
 const kilograms=Number(value?.kilograms);if(!Number.isFinite(kilograms)||kilograms<=0||kilograms>1e9)throw Error('Captura los kilos preparados.');
 const outputGrams=Math.round(kilograms*1000000)/1000;if(!outputGrams)throw Error('La mezcla debe ser de al menos 0.001 g.');
 if(!Array.isArray(value?.ingredients)||!value.ingredients.length||value.ingredients.length>100)throw Error('Agrega las tintas utilizadas.');
 const grouped=new Map();for(const item of value.ingredients){const id=Number(item.lot_id),kg=Number(item.kilograms),grams=Math.round(kg*1000000)/1000;if(!Number.isSafeInteger(id)||id<=0||!Number.isFinite(kg)||kg<=0||!grams||kg>1e9)throw Error('Revisa el lote y los kilos de cada tinta.');grouped.set(id,Math.round(((grouped.get(id)||0)+grams)*1000)/1000);}
 const ingredients=[...grouped].map(([lot_id,grams])=>({lot_id,grams}));if(outputGrams>ingredients.reduce((sum,i)=>sum+i.grams,0)+.00001)throw Error('Los kilos preparados no pueden superar la suma de ingredientes.');
 return {outputGrams,ingredients};
}
