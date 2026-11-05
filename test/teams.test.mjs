import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseTeamsOrders} from '../netlify/lib/teams-parser.mjs';
import handler from '../netlify/functions/teams-orders.mjs';
const html=readFileSync(new URL('./fixtures/teams-order.html',import.meta.url),'utf8');
test('Teams HTML with merged cells preserves requested order, schedule, quantities and tooling',()=>{
 const [o]=parseTeamsOrders(html);assert.equal(o.folio,'OP-2026-00102');assert.equal(o.np,'NP016-1');assert.equal(o.client,'CLIENTE PRUEBA');assert.equal(o.product,'CONTROL DE CALIDAD AZUL 291');assert.equal(o.pieces,1200000);assert.equal(o.meters,12725);assert.equal(o.scheduled_date,'2026-10-30');assert.equal(o.scheduled_start,'07:40');assert.equal(o.scheduled_end,'16:00');assert.equal(o.specifications.colores,'NEGRO · AZUL · BARNIZ TRANSPARENTE');assert.equal(o.specifications.suaje,'SJ059-1 · LAMINADO');assert.equal(parseTeamsOrders(html+html.replace('00102','00103')).length,2);
});
test('Teams parser rejects photographs, malformed dates and ambiguous amounts instead of guessing',()=>{
 assert.throws(()=>parseTeamsOrders('<img src="attachment">'),/OCR/);assert.throws(()=>parseTeamsOrders(html.replace('30/10/2026','31/02/2026')),/Fecha/);assert.throws(()=>parseTeamsOrders(html.replace('12,725','12.725,00')),/ambigua/);assert.throws(()=>parseTeamsOrders('x'.repeat(200001)),/grande/);
 const malicious=html.replace('CLIENTE PRUEBA','&lt;script&gt;alert(1)&lt;/script&gt;');assert.equal(parseTeamsOrders(malicious)[0].client,'<script>alert(1)</script>');
});
test('Netlify receiver requires integration key and sends parsed data to the limited RPC',async t=>{
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});let call;
 globalThis.fetch=async(url,options)=>{call={url,options};return Response.json({ok:true,order_ids:[42]});};
 assert.equal((await handler(new Request('https://test/api/teams-orders'))).status,405);
 const request=key=>new Request('https://test/api/teams-orders',{method:'POST',headers:{'Content-Type':'application/json',...(key?{'X-Integration-Key':key}:{})},body:JSON.stringify({conversation_id:'chat-test',message_id:'message-test',html})});
 assert.equal((await handler(request())).status,401);assert.equal(call,undefined);
 const token='tt_'+'a'.repeat(64),response=await handler(request(token));assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,order_ids:[42]});assert.ok(call.url.endsWith('/prisma_receive_teams'));assert.equal(call.options.headers.Authorization,undefined);const body=JSON.parse(call.options.body);assert.equal(body.integration_token,token);assert.equal(body.payload.orders[0].pieces,1200000);assert.equal(body.payload.html,undefined);
});
