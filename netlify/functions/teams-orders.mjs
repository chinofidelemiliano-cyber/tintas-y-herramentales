import {readFile} from 'node:fs/promises';
import {parseTeamsOrders} from '../lib/teams-parser.mjs';
const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export default async request=>{
 if(request.method!=='POST')return reply(405,{error:'Usa POST desde Power Automate.'});
 const integrationToken=request.headers.get('X-Integration-Key');if(!integrationToken||!/^tt_[a-f0-9]{64}$/.test(integrationToken))return reply(401,{error:'Conexión no autorizada.'});
 try{
  if(Number(request.headers.get('Content-Length'))>250000)return reply(413,{error:'Mensaje demasiado grande.'});
  const raw=await request.text();if(raw.length>250000)return reply(413,{error:'Mensaje demasiado grande.'});
  const body=JSON.parse(raw);if(!body.message_id||!body.conversation_id||typeof body.html!=='string')return reply(400,{error:'Falta message_id, conversation_id o html.'});
  const orders=parseTeamsOrders(body.html),config=JSON.parse(await readFile(process.cwd()+'/public/cloud-config.json','utf8'));
  const response=await fetch(config.supabaseUrl+'/rest/v1/rpc/prisma_receive_teams',{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({integration_token:integrationToken,payload:{message_id:String(body.message_id),conversation_id:String(body.conversation_id),orders}})});
  const result=await response.json();if(!response.ok)return reply(400,{error:result.message||'No se pudo registrar la orden.'});return reply(200,result);
 }catch(error){return reply(400,{error:error instanceof SyntaxError?'Mensaje JSON no válido.':error.message||'No se pudo procesar el mensaje.'});}
};
