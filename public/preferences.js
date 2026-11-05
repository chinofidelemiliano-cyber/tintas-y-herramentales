import {defaultPDFStyle,normalizePDFStyle} from './pdf-style.js';
import {jpegPhoto} from './incident-photos.js';
const key='inventory-display-preferences-v1';
export const defaults=Object.freeze({language:'es',theme:'light',accent:'green',siteName:'Mi inventario',dateFormat:'short',density:'comfortable',expandInventory:true,reportLogo:null,pdfStyle:defaultPDFStyle});
export function normalizePreferences(value={}){
 let reportLogo=null;if(typeof value?.reportLogo==='string'){try{jpegPhoto(value.reportLogo);reportLogo=value.reportLogo;}catch{}}
 const choose=(field,allowed)=>allowed.includes(value?.[field])?value[field]:defaults[field];
 return {reportLogo,pdfStyle:normalizePDFStyle(value?.pdfStyle),language:choose('language',['es','en']),theme:choose('theme',['light','dark','system']),accent:choose('accent',['green','blue','purple']),siteName:typeof value?.siteName==='string'&&value.siteName.trim()?value.siteName.replace(/[\x00-\x1f]/g,'').trim().slice(0,40):defaults.siteName,dateFormat:choose('dateFormat',['short','dmy','mdy','iso']),density:choose('density',['comfortable','compact']),expandInventory:typeof value?.expandInventory==='boolean'?value.expandInventory:defaults.expandInventory};
}
export function readPreferences(userId){try{return normalizePreferences(JSON.parse(localStorage.getItem(userId?key+':'+userId:key)||'{}'));}catch{return {...defaults};}}
export function savePreferences(value,userId){const result=normalizePreferences(value);localStorage.setItem(userId?key+':'+userId:key,JSON.stringify(result));return result;}
export function formatDisplayDate(value,preferences){
 const date=new Date(value+'T12:00:00');
 if(!Number.isFinite(date.getTime()))return value;
 if(preferences.dateFormat==='iso')return value;
 if(preferences.dateFormat==='dmy')return value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(0,4);
 if(preferences.dateFormat==='mdy')return value.slice(5,7)+'/'+value.slice(8,10)+'/'+value.slice(0,4);
 return date.toLocaleDateString(preferences.language==='en'?'en-US':'es-MX',{day:'2-digit',month:'short',year:'numeric'}).replaceAll('.','');
}

// Import the old browser settings into only the first profile used on this device.
export function initialProfilePreferences(userId){
 try{const cached=localStorage.getItem(key+':'+userId);if(cached)return normalizePreferences(JSON.parse(cached));const owner=localStorage.getItem(key+':imported-by');if(!owner||owner===userId)return readPreferences();}catch{}
 return normalizePreferences();
}
export function cacheProfilePreferences(value,userId){
 const result=normalizePreferences(value);
 try{savePreferences(result,userId);localStorage.setItem(key+':imported-by',userId);}catch{}
 return result;
}
export async function loadProfilePreferences(cloud){
 const remote=await cloud.preferences();
 if(remote!==null)return cacheProfilePreferences(remote,cloud.userId());
 const imported=await cloud.savePreferences(initialProfilePreferences(cloud.userId()),true);
 return cacheProfilePreferences(imported,cloud.userId());
}
