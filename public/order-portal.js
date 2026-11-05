import {formatQuantity} from './quantity.js';
import {mountInkPicker} from './ink-picker.js';
import {normalizePortalOrder} from './order-portal-model.js';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const accessKey=new URLSearchParams(location.hash.slice(1)).get('key')||'',storageKey='order-portal-draft-'+accessKey.slice(-12);
let config,rows=[],hasMore=false,busy=false,pending=null,picker;
const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname)&&!new URLSearchParams(location.search).has('cloud');
async function api(payload){
 let response;if(local)response=await fetch('/api/order-portal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_key:accessKey,payload})});
 else{config ||= await (await fetch('/cloud-config.json',{cache:'no-store'})).json();if(!config.enabled||!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(config.supabaseUrl))throw Error('La página aún no está conectada. Contacta al administrador.');response=await fetch(config.supabaseUrl+'/rest/v1/rpc/prisma_order_portal',{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({access_key:accessKey,payload})});}
 const data=await response.json();if(!response.ok){if(payload.operation==='catalog'&&data.message==='Acción no permitida.')throw Error('El administrador debe activar colores ejecutando colors-preparation.sql en Supabase.');if(['PGRST202','42883'].includes(data.code))throw Error('Falta activar la página compartida. El administrador debe ejecutar colors-preparation.sql en Supabase.');throw Error(data.error||data.message||'No se pudo guardar. Intenta de nuevo.');}return data;
}
const number=n=>formatQuantity(n);
function renderQueue(){
 $('#order-list').innerHTML=rows.length?rows.map(o=>`<article class="order-card"><div class="sequence"><small>SECUENCIA</small>#${String(o.queue_number).padStart(3,'0')}</div><div><h3>${esc(o.folio)} · ${esc(o.np)}</h3><p><strong>${esc(o.product)}</strong>${o.client?' · '+esc(o.client):''}</p><p>${esc(o.scheduled_date)} · ${esc(o.scheduled_start)}${o.scheduled_end?' → '+esc(o.scheduled_end)+(o.scheduled_end<o.scheduled_start?' (día siguiente)':''):''}<br>${esc(o.pressman)} · ${esc(o.machine)}</p><p class="colors">Colores: ${esc(o.colors)}</p>${o.die||o.crease?`<p>${o.die?'Suaje: '+esc(o.die):''}${o.die&&o.crease?' · ':''}${o.crease?'Pleca: '+esc(o.crease):''}</p>`:''}${o.pieces!=null||o.planned_meters!=null?`<p>${o.pieces!=null?number(o.pieces)+' piezas':''}${o.pieces!=null&&o.planned_meters!=null?' · ':''}${o.planned_meters!=null?number(o.planned_meters)+' m':''}</p>`:''}${o.notes?`<p>${esc(o.notes)}</p>`:''}</div><span class="order-status ${o.started_at&&!o.ended_at?'running':''}">${o.status==='cancelled'?'Cancelada':o.ended_at?'Preparada':o.started_at?'En curso':'En espera'}</span></article>`).join(''):'<p class="empty">No hay órdenes en esta lista. La siguiente captura ocupará su lugar al guardarse.</p>';
 $('#load-more').hidden=!hasMore;$('#updated').textContent='Actualizado '+new Intl.DateTimeFormat('es-MX',{hour:'2-digit',minute:'2-digit',timeZone:'America/Mexico_City'}).format(new Date());
 $('#pressmen').innerHTML=[...new Set(rows.map(o=>o.pressman))].map(name=>`<option value="${esc(name)}"></option>`).join('');
}
async function refresh(append=false){
 if(busy)return;busy=true;$('#refresh').disabled=true;$('#load-more').disabled=true;$('#queue-error').hidden=true;
 try{const target=append?50:Math.max(50,rows.length);let result,next=[],cursor=append?(rows.at(-1)?.queue_number||0):0;
 do{result=await api({operation:'list',after_sequence:cursor,include_finished:$('#include-finished').checked});next.push(...result.orders);cursor=next.at(-1)?.queue_number||cursor;}while(result.has_more&&next.length<target);
 rows=append?[...rows,...next]:next;hasMore=result.has_more;renderQueue();$('#connection').textContent='Conectado';
 }catch(error){$('#queue-error').textContent=error.message;$('#queue-error').hidden=false;$('#connection').textContent='Sin conexión';throw error;}finally{busy=false;$('#refresh').disabled=false;$('#load-more').disabled=false;}
}
function saveDraft(){try{sessionStorage.setItem(storageKey,JSON.stringify({fields:Object.fromEntries(new FormData($('#order-form'))),ink_selections:picker?.value(),pending}));}catch{}}
async function initialize(){
 if(!/^op_[a-f0-9]{64}$/.test(accessKey))throw Error('Abre el enlace completo de captura que te compartió el administrador.');
 await refresh();const catalog=await api({operation:'catalog'});picker=mountInkPicker($('#ink-picker'),$('#order-form').elements.machine,catalog.products);for(const [type,id]of [['suaje','die'],['pleca','crease']]){const tools=(catalog.tools||[]).filter(t=>t.tool_type===type&&t.code.startsWith(type==='suaje'?'SJ':'PD')).sort((a,b)=>a.code.localeCompare(b.code,'es',{numeric:true}));$('#'+id+'-select').innerHTML='<option value="">Sin '+type+' seleccionado</option>'+tools.map(t=>`<option value="${t.id}">${esc(t.code)}</option>`).join('');$('#'+id+'-hint').textContent=tools.length?'Selecciona el herramental para esta orden.':'Catálogo de '+type+' pendiente de cargar.';}$('#workspace').hidden=false;
 const form=$('#order-form');form.elements.scheduled_date.value=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved){for(const [key,value]of Object.entries(saved.fields||{}))if(form.elements.namedItem(key))form.elements.namedItem(key).value=value;picker.restore(saved.ink_selections||[]);pending=saved.pending;}}catch{}
 form.addEventListener('input',saveDraft);
 form.onsubmit=async event=>{
  event.preventDefault();$('#form-error').hidden=true;$('#form-success').hidden=true;let order;
  try{order=normalizePortalOrder({...Object.fromEntries(new FormData(form)),ink_selections:picker.value()});}catch(error){$('#form-error').textContent=error.message;$('#form-error').hidden=false;return;}
  if(!pending||JSON.stringify(pending.order)!==JSON.stringify(order))pending={request_key:crypto.randomUUID(),order};saveDraft();$('#order-fields').disabled=true;
  try{const result=await api({operation:'submit',...pending});pending=null;const keep={pressman:order.pressman,machine:order.machine,scheduled_date:order.scheduled_date};form.reset();for(const [key,value]of Object.entries(keep))form.elements.namedItem(key).value=value;picker.reset();try{sessionStorage.removeItem(storageKey);}catch{}
   $('#form-success').textContent=`Orden ${order.folio} registrada en la secuencia #${String(result.queue_number).padStart(3,'0')}. Ya está disponible en planta.`;$('#form-success').hidden=false;
   await refresh().catch(()=>{});
  }catch(error){$('#form-error').textContent=error.message;$('#form-error').hidden=false;}finally{$('#order-fields').disabled=false;}
 };
 $('#refresh').onclick=()=>refresh().catch(()=>{});$('#load-more').onclick=()=>refresh(true).catch(()=>{});$('#include-finished').onchange=()=>{rows=[];refresh().catch(()=>{});};
 setInterval(()=>{if(!document.hidden){refresh().catch(()=>{});api({operation:'catalog'}).then(c=>picker.update(c.products)).catch(()=>{});}},30000);
}
initialize().catch(error=>{$('#access-error').textContent=error.message;$('#access-error').hidden=false;$('#connection').textContent='Enlace no disponible';});
