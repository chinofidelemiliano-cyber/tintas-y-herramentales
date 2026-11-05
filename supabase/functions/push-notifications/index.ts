// @ts-nocheck
// Generado por scripts/build-push-function.mjs. Archivo único para el editor de Supabase.
import webpush from "npm:web-push@3.6.7";
export function allowedPushEndpoint(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/^(?:fcm\.googleapis\.com|fcmregistrations\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/.test(u.hostname)&&value.length<=3000;}catch{return false;}}
export function constantSecretEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;let difference=0;for(let i=0;i<64;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
export function createPushHandler({store,generateKeys,send,edgeUrl,randomSecret}){
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-dispatch-key','Access-Control-Allow-Methods':'POST,OPTIONS'};
 const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers});
 return async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply(405,{error:'Usa POST.'});
  if(Number(request.headers.get('Content-Length'))>2000)return reply(413,{error:'Solicitud demasiado grande.'});
  let body;try{const text=await request.text();if(text.length>2000)return reply(413,{error:'Solicitud demasiado grande.'});body=JSON.parse(text);}catch{return reply(400,{error:'Solicitud no válida.'});}
  try{
   if(body?.action==='config'){
    const token=request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];if(!token)return reply(401,{error:'Inicia sesión para activar las notificaciones.'});
    const user=await store.authorize(token);if(!user)return reply(403,{error:'Tu cuenta no tiene acceso.'});
    const keys=generateKeys();const config=await store.configuration({public_key:keys.publicKey,private_key:keys.privateKey,subject:/^[^\s@]+@[^\s@]+$/.test(user.email||'')?'mailto:'+user.email:'https://supabase.com',dispatch_secret:randomSecret(),edge_url:edgeUrl});
    return reply(200,{public_key:config.public_key});
   }
   if(body?.action!=='dispatch')return reply(400,{error:'Acción no válida.'});
   const dispatchKey=request.headers.get('X-Dispatch-Key');if(!/^[a-f0-9]{64}$/.test(dispatchKey||''))return reply(401,{error:'Envío no autorizado.'});
   const config=await store.configuration();if(!config||!constantSecretEqual(dispatchKey,config.dispatch_secret))return reply(401,{error:'Envío no autorizado.'});
   const jobs=await store.claim();let sent=0,failed=0,next=0;
   async function worker(){while(next<jobs.length){const job=jobs[next++];let success=false,retired=false,reason='PUSH_NETWORK';try{if(!allowedPushEndpoint(job.subscription?.endpoint)){retired=true;reason='INVALID_ENDPOINT';}else{await send(job.subscription,JSON.stringify(job.payload),{vapidDetails:{subject:config.subject,publicKey:config.public_key,privateKey:config.private_key},TTL:3600,urgency:'high',timeout:10000});success=true;}}catch(error){const status=Number(error.statusCode)||0;retired=status===404||status===410;reason=status?'PUSH_HTTP_'+status:'PUSH_NETWORK';}await store.finish({id:job.id,attempt:job.attempt,success,retired,reason});if(success)sent++;else failed++;}}
   await Promise.all(Array.from({length:Math.min(4,jobs.length)},worker));
   return reply(200,{sent,failed});
  }catch{return reply(503,{error:'No se pudo completar el envío. Revisa la instalación de device-notifications.sql y la función push-notifications.'});}
 };
}

const supabaseUrl=Deno.env.get('SUPABASE_URL'),anonKey=Deno.env.get('SUPABASE_ANON_KEY'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
async function rpc(name,payload,token=serviceKey,key=serviceKey){
 const response=await fetch(supabaseUrl+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 if(!response.ok){const body=await response.json().catch(()=>({}));const error=Error('RPC_FAILED');error.code=body.code;throw error;}const text=await response.text();return text?JSON.parse(text):null;
}
const store={
 authorize:async token=>{const response=await fetch(supabaseUrl+'/auth/v1/user',{headers:{apikey:anonKey,Authorization:'Bearer '+token}});if(!response.ok)return null;const user=await response.json();try{await rpc('prisma_devices',{payload:{operation:'list'}},token,anonKey);}catch(error){if(error.code==='P0001')return null;throw error;}return user;},
 configuration:candidate=>rpc('prisma_push_configuration',{candidate:candidate||null}),claim:()=>rpc('prisma_claim_push_jobs',{}),finish:payload=>rpc('prisma_finish_push_job',{payload})
};
async function sendPush(subscription,payload,options){
 const details=webpush.generateRequestDetails(subscription,payload,options),headers=new Headers(details.headers);headers.delete('content-length');
 const response=await fetch(details.endpoint,{method:details.method,headers,body:details.body,redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok){const error=Error('PUSH_REJECTED');error.statusCode=response.status;throw error;}
 await response.body?.cancel();
}
Deno.serve(createPushHandler({store,generateKeys:()=>webpush.generateVAPIDKeys(),send:sendPush,edgeUrl:supabaseUrl+'/functions/v1/push-notifications',randomSecret:()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('')}));
