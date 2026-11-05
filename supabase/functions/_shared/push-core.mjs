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
