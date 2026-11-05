import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowedView,permissionLabels} from '../public/account-permissions.js';
import {rememberLoginAppearance,readLoginPreferences,initialProfilePreferences,savePreferences,cacheProfilePreferences} from '../public/preferences.js';
test('pending accounts have no views and only administrators see account management',()=>{
 const pending={is_admin:false,permissions:[]};for(const view of ['inventario','ordenes','administracion','configuracion'])assert.ok(!allowedView(view,pending));
 assert.ok(allowedView('preparacion',{permissions:['preparation']}));assert.ok(!allowedView('ordenes',{permissions:['preparation']}));assert.ok(allowedView('administracion',{is_admin:true,permissions:[]}));assert.ok(!allowedView('administracion',null));assert.equal(Object.keys(permissionLabels).length,9);
});
test('login appearance survives logout without sharing profile names or report settings',t=>{
 const old=globalThis.localStorage,values=new Map();globalThis.localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};t.after(()=>globalThis.localStorage=old);
 savePreferences({siteName:'Nombre privado',theme:'light'});cacheProfilePreferences({siteName:'Perfil privado',theme:'dark',pdfStyle:{fontSize:13}},'owner');
 assert.equal(readLoginPreferences().theme,'dark');const another=initialProfilePreferences('another');assert.equal(another.theme,'dark');assert.equal(another.siteName,'Mi inventario');assert.notEqual(another.pdfStyle.fontSize,13);
 rememberLoginAppearance({theme:'light',siteName:'No copiar'});assert.equal(readLoginPreferences().theme,'light');assert.ok(!values.get('inventory-login-appearance-v1').includes('No copiar'));
});
