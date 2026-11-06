import {effectiveTimeZone} from './time.js';
import {sessionDeviceInfo} from './session-device.js';
let initialized;
const storageKey='prisma-cloud-session';
export async function getCloud(){
 if(initialized)return initialized;
 initialized=(async()=>{
  const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
  if(local&&!new URLSearchParams(location.search).has('cloud'))return null;
  const response=await fetch('/cloud-config.json',{cache:'no-store'});if(!response.ok)return null;
  const config=await response.json();if(!config.enabled)return null;
  if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(config.supabaseUrl)||!config.publishableKey?.startsWith('sb_publishable_'))throw Error('Configuración de conexión no válida.');
  let session;try{session=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{sessionStorage.removeItem(storageKey);}
  const save=value=>{session=value;if(value)sessionStorage.setItem(storageKey,JSON.stringify(value));else sessionStorage.removeItem(storageKey);};
  async function auth(route,body,persistSession=true){
   const r=await fetch(config.supabaseUrl+'/auth/v1/'+route,{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)});
   const data=await r.json();if(!r.ok)throw Error(data.msg||data.error_description||data.message||'No se pudo iniciar sesión.');
   if(persistSession&&data.access_token)save({...data,expires_at:Math.floor(Date.now()/1000)+(data.expires_in||3600)});return data;
  }
  async function token(){if(!session)throw Error('Inicia sesión para continuar.');if(session.expires_at<Date.now()/1000+60){try{await auth('token?grant_type=refresh_token',{refresh_token:session.refresh_token});}catch{save(null);throw Error('Tu sesión terminó. Inicia sesión nuevamente.');}}return session.access_token;}
  async function rpc(name,body={}){
   const access=await token();
   const r=await fetch(config.supabaseUrl+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:config.publishableKey,Authorization:'Bearer '+access,'Content-Type':'application/json','X-Client-Info':'inventory-web; time-zone='+effectiveTimeZone()},body:JSON.stringify(body)});
   const data=await r.json();
   if(!r.ok){
    if(r.status===401)save(null);
    if((data.code==='PGRST202'||data.code==='42883')&&['prisma_account_access','prisma_admin_accounts','prisma_admin_login_sessions','prisma_login_activity'].includes(name)){const error=Error('Falta activar cuentas y permisos. Ejecuta supabase/accounts-and-sessions.sql completo.');error.code='ACCOUNT_MIGRATION_REQUIRED';throw error;}
    if(data.code==='PGRST202'||data.code==='42883')throw Error(name==='prisma_press_sheets'?'Falta activar las hojas de prensista. Ejecuta supabase/press-sheets.sql completo.':['prisma_order_comments','prisma_manage_order_status'].includes(name)?'Activa el seguimiento y comentarios ejecutando supabase/order-status-and-comments.sql completo.':name==='prisma_order_ink_options'?'Activa las opciones ejecutando supabase/order-ink-options.sql en SQL Editor.':name==='prisma_devices'?'Falta activar Administrar dispositivos. Ejecuta supabase/device-notifications.sql completo en SQL Editor.':name==='prisma_complete_pantone'?'Falta activar colores y preparación. Ejecuta supabase/colors-preparation.sql completo.':name==='prisma_manage_order_portal'?'Falta activar la página compartida. Ejecuta supabase/manual-order-portal.sql completo en SQL Editor.':['prisma_order_clock','prisma_teams_connection'].includes(name)?'Falta activar producción y Teams. Ejecuta supabase/production-tracking-teams.sql completo en SQL Editor.':['prisma_get_preferences','prisma_save_preferences'].includes(name)?'Falta activar la configuración de perfil. Ejecuta supabase/profile-preferences.sql completo en SQL Editor.':['prisma_save_incident','prisma_start_incident','prisma_incident_evidence'].includes(name)?'Falta activar incidencias. Ejecuta supabase/incidents.sql en SQL Editor.':name==='prisma_save_preparation'?'Falta activar los tiempos de preparación. Ejecuta supabase/preparation-times.sql en SQL Editor.':'Falta ejecutar el archivo supabase/setup.sql en SQL Editor de Supabase.');
    throw Error(data.message||'No se pudo guardar en la base de datos.');
   }
   return data;
  }
  let auditSession='';
  const audit=async operation=>{if(!session)return;const id=session.user?.id+':'+session.access_token.split('.')[1];if(operation==='login'&&auditSession===id)return;await rpc('prisma_login_activity',{payload:{operation,...(operation==='login'?sessionDeviceInfo(session.user?.id):{})}});if(operation==='login')auditSession=id;};
  return {pressSheets:payload=>rpc('prisma_press_sheets',{payload}),orderComments:payload=>rpc('prisma_order_comments',{payload}),manageOrderStatus:payload=>rpc('prisma_manage_order_status',{payload}),inkOptions:payload=>rpc('prisma_order_ink_options',{payload}),accountAccess:()=>rpc('prisma_account_access'),adminAccounts:payload=>rpc('prisma_admin_accounts',{payload}),adminSessions:(payload={operation:'list'})=>rpc('prisma_admin_login_sessions',{payload}),recordLogin:()=>audit('login'),heartbeat:()=>audit('heartbeat'),hasSession:()=>!!session,userId:()=>session?.user?.id||'',preferences:()=>rpc('prisma_get_preferences'),savePreferences:(payload,only_if_missing=false)=>rpc('prisma_save_preferences',{payload,only_if_missing}),displayName:()=>{const m=session?.user?.user_metadata||{};return String(m.full_name||m.display_name||m.name||'').trim().slice(0,100);},email:()=>session?.user?.email||'',signIn:(email,password)=>auth('token?grant_type=password',{email,password}),verifySignup:(email,code)=>auth('verify',{email,token:code,type:'signup'}),resendSignup:email=>auth('resend',{email,type:'signup'},false),
   signOut:async()=>{try{await audit('logout').catch(()=>{});if(session)await fetch(config.supabaseUrl+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:config.publishableKey,Authorization:'Bearer '+session.access_token}});}finally{auditSession='';save(null);}},
   devices:payload=>rpc('prisma_devices',{payload}),pushConfiguration:async()=>{const access=await token();const response=await fetch(config.supabaseUrl+'/functions/v1/push-notifications',{method:'POST',headers:{apikey:config.publishableKey,Authorization:'Bearer '+access,'Content-Type':'application/json','X-Client-Info':'inventory-web; time-zone='+effectiveTimeZone()},body:JSON.stringify({action:'config'})});let data;try{data=await response.json();}catch{}if(!response.ok)throw Error(response.status===404?'Falta desplegar la función push-notifications en Supabase.':data?.error||'No se pudo activar el servicio de envío.');return data;},state:()=>rpc('prisma_state'),evidence:record_id=>rpc('prisma_incident_evidence',{record_id}),action:(operation,payload)=>operation==='pantones/complete'?rpc('prisma_complete_pantone',{payload}):operation==='order-portal/manage'?rpc('prisma_manage_order_portal',{payload}):operation==='orders/clock'?rpc('prisma_order_clock',{payload}):operation==='teams/connection'?rpc('prisma_teams_connection',{payload}):operation==='incidents/start'?rpc('prisma_start_incident',{payload}):operation==='incidents'?rpc('prisma_save_incident',{payload}):operation==='preparations'?rpc('prisma_save_preparation',{payload}):rpc('prisma_action',{operation,payload})};
 })();
 return initialized;
}
