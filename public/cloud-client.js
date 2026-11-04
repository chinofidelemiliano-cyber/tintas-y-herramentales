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
  async function auth(route,body){
   const r=await fetch(config.supabaseUrl+'/auth/v1/'+route,{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)});
   const data=await r.json();if(!r.ok)throw Error(data.msg||data.error_description||data.message||'No se pudo iniciar sesión.');
   save({...data,expires_at:Math.floor(Date.now()/1000)+(data.expires_in||3600)});return data;
  }
  async function token(){if(!session)throw Error('Inicia sesión para continuar.');if(session.expires_at<Date.now()/1000+60){try{await auth('token?grant_type=refresh_token',{refresh_token:session.refresh_token});}catch{save(null);throw Error('Tu sesión terminó. Inicia sesión nuevamente.');}}return session.access_token;}
  async function rpc(name,body={}){
   const access=await token();
   const r=await fetch(config.supabaseUrl+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:config.publishableKey,Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify(body)});
   const data=await r.json();
   if(!r.ok){
    if(r.status===401)save(null);
    if(data.code==='PGRST202'||data.code==='42883')throw Error(['prisma_save_incident','prisma_start_incident','prisma_incident_evidence'].includes(name)?'Falta activar incidencias. Ejecuta supabase/incidents.sql en SQL Editor.':name==='prisma_save_preparation'?'Falta activar los tiempos de preparación. Ejecuta supabase/preparation-times.sql en SQL Editor.':'Falta ejecutar el archivo supabase/setup.sql en SQL Editor de Supabase.');
    throw Error(data.message||'No se pudo guardar en la base de datos.');
   }
   return data;
  }
  return {hasSession:()=>!!session,email:()=>session?.user?.email||'',signIn:(email,password)=>auth('token?grant_type=password',{email,password}),
   signOut:async()=>{try{if(session)await fetch(config.supabaseUrl+'/auth/v1/logout',{method:'POST',headers:{apikey:config.publishableKey,Authorization:'Bearer '+session.access_token}});}finally{save(null);}},
   state:()=>rpc('prisma_state'),evidence:record_id=>rpc('prisma_incident_evidence',{record_id}),action:(operation,payload)=>operation==='incidents/start'?rpc('prisma_start_incident',{payload}):operation==='incidents'?rpc('prisma_save_incident',{payload}):operation==='preparations'?rpc('prisma_save_preparation',{payload}):rpc('prisma_action',{operation,payload})};
 })();
 return initialized;
}
