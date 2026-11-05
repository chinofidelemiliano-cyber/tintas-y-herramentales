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
export function savePreferences(value,userId){const result=normalizePreferences(value);rememberLoginAppearance(result);localStorage.setItem(userId?key+':'+userId:key,JSON.stringify(result));return result;}
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
 try{const cached=localStorage.getItem(key+':'+userId);if(cached)return normalizePreferences(JSON.parse(cached));const owner=localStorage.getItem(key+':imported-by');if(!owner||owner===userId)return readLoginPreferences();}catch{}
 const appearance=readLoginPreferences();return normalizePreferences({theme:appearance.theme,language:appearance.language,accent:appearance.accent});
}
export function cacheProfilePreferences(value,userId){
 const result=normalizePreferences(value);rememberLoginAppearance(result);
 try{savePreferences(result,userId);localStorage.setItem(key+':imported-by',userId);}catch{}
 return result;
}
export async function loadProfilePreferences(cloud){
 const remote=await cloud.preferences();
 if(remote!==null)return cacheProfilePreferences(remote,cloud.userId());
 const imported=await cloud.savePreferences(initialProfilePreferences(cloud.userId()),true);
 return cacheProfilePreferences(imported,cloud.userId());
}

const appearanceKey='inventory-login-appearance-v1';
export function rememberLoginAppearance(value){const normalized=normalizePreferences(value);try{localStorage.setItem(appearanceKey,JSON.stringify({theme:normalized.theme,language:normalized.language,accent:normalized.accent}));}catch{}}
export function readLoginPreferences(){const base=readPreferences();try{const saved=JSON.parse(localStorage.getItem(appearanceKey)||'null');if(saved)return normalizePreferences({...base,theme:saved.theme,language:saved.language,accent:saved.accent});}catch{}return base;}
