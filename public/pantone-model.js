import {decimalSum} from './quantity.js';
export function mixtureRecipe(value){
 const toGrams=item=>item?.grams!=null?Number(item.grams):Number(item?.kilograms)*1000;
 const outputGrams=toGrams(value);if(!Number.isFinite(outputGrams)||outputGrams<=0||outputGrams>1e12)throw Error('Captura los gramos preparados.');
 if(!Array.isArray(value?.ingredients)||!value.ingredients.length||value.ingredients.length>100)throw Error('Agrega las tintas utilizadas.');
 const grouped=new Map();for(const item of value.ingredients){const id=Number(item.lot_id),grams=toGrams(item);if(!Number.isSafeInteger(id)||id<=0||!Number.isFinite(grams)||grams<=0||grams>1e12)throw Error('Revisa el lote y los gramos de cada tinta.');grouped.set(id,decimalSum([grouped.get(id)||0,grams]));}
 const ingredients=[...grouped].map(([lot_id,grams])=>({lot_id,grams}));if(outputGrams>decimalSum(ingredients.map(i=>i.grams)))throw Error('Los gramos preparados no pueden superar la suma de ingredientes.');
 return {outputGrams,ingredients};
}
