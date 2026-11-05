import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),core=await readFile(new URL('supabase/functions/_shared/push-core.mjs',root),'utf8');
const adapter=`
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
`;
await writeFile(new URL('supabase/functions/push-notifications/index.ts',root),'// @ts-nocheck\n// Generado por scripts/build-push-function.mjs. Archivo único para el editor de Supabase.\nimport webpush from "npm:web-push@3.6.7";\n'+core+adapter);
