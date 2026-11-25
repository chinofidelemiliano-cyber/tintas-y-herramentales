import {createTablePDF} from './pdf-report.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number=new Intl.NumberFormat('es-MX',{maximumFractionDigits:3});
const kg=grams=>number.format(Number(grams)/1000)+' kg';
const n=value=>value==null||value===''?'—':number.format(value);
const cell=value=>`<td>${esc(value)}</td>`;
const table=(headers,rows)=>`<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const row=(values,actions='')=>'<tr>'+values.map(cell).join('')+(actions?'<td>'+actions+'</td>':'')+'</tr>';
const button=(label,action,value='')=>`<button type="button" class="btn" data-plant-action="${action}" data-value="${esc(value)}">${esc(label)}</button>`;
const field=(label,name,value='',type='text',attrs='')=>`<label class="field">${esc(label)}<input type="${type}" name="${name}" value="${esc(value)}" ${attrs}></label>`;
const options=(values,selected)=>values.map(([value,label])=>`<option value="${esc(value)}" ${String(value)===String(selected)?'selected':''}>${esc(label)}</option>`).join('');
const select=(label,name,values,selected,attrs='')=>`<label class="field">${esc(label)}<select name="${name}" ${attrs}>${options(values,selected)}</select></label>`;
const cols=(headers,widths)=>headers.map((label,index)=>({label,width:widths[index]}));

export function inkRecommendations(inks,days) {
 const sorted=[...inks].sort((a,b)=>b.consumed-a.consumed||a.code.localeCompare(b.code));
 const total=sorted.reduce((sum,ink)=>sum+Number(ink.consumed),0);
 let accumulated=0;
 return sorted.map(ink=>{
  const before=total?accumulated/total:1;
  accumulated+=Number(ink.consumed);
  const suggestion=ink.indispensable?'A':!ink.consumed?'C':before<.8?'A':before<.95?'B':'C';
  const daily=Number(ink.consumed)/days;
  const minimum=daily*(ink.lead_days+ink.safety_days),maximum=minimum+daily*ink.review_days;
  const alert=daily>0&&Number(ink.on_hand)<=minimum+daily;
  return {...ink,suggestion,minimum,maximum,middle:(minimum+maximum)/2,alert};
 });
}

const stationFields={family:'Tipo de tinta',color:'Color',anilox:'Anilox',plate:'Placa / manga',th:'TH',sticky:'Sticky Back',blade:'Rasqueta',dryer:'Secador',distance:'Distancia',dr:'DR Roll',tray:'Charola'};
const recipeFields={speed:'Velocidad',turnbar:'Volteador',laminate:'Laminado',blade:'Tipo de rasqueta',unwind:'Tensión desbobinador',rewind:'Tensión rebobinado',notes:'Instrucciones especiales'};
function download(title,pdf){
 const url=URL.createObjectURL(new Blob([pdf],{type:'application/pdf'}));
 const anchor=document.createElement('a');
 anchor.href=url;anchor.download=title+'.pdf';anchor.click();
 setTimeout(()=>URL.revokeObjectURL(url),10000);
}
export function supplyEmail(items){
 const grouped=new Map();
 for(const item of items){
  const provider=item.provider?.trim();
  if(!grouped.has(provider))grouped.set(provider,[]);
  grouped.get(provider).push(`• ${item.name} (${item.code}): ${number.format(item.kg)} kg.`);
 }
 const list=[...grouped].map(([provider,lines])=>[provider||'',...lines].filter(Boolean).join('\n')).join('\n\n');
 return {subject:'Solicitud de compra de tintas',body:`Buen día, Maribel:\n\nSolicito tu apoyo para gestionar la adquisición de las siguientes tintas:\n\n${list}\n\nAgradezco tu apoyo. Quedo pendiente de tus comentarios.\n\nSaludos.`};
}

function regrindPDF(services){
 const data=services.map(({snapshot:s,code,sent_on,received_on,receipt})=>{
  const details=s.details||{};
  const type=code.startsWith('PD')?'Pleca':'Suaje';
  const measures=[details.axis_measure,details.development_measure].filter(Boolean).join(' × ')||'________';
  const shared=[type,code,details.serial||'________',measures,details.th||'________',n(s.cycle_meters)];
  return {
   out:[sent_on,...shared,'Reafile'],
   back:[received_on||'________',...shared,receipt?.gear?receipt.gear==='yes'?'Sí':'No':'[ ] Sí  [ ] No',
    receipt?.material||'________',receipt?.passes?receipt.passes==='yes'?'Sí':'No':'[ ] Sí  [ ] No',receipt?.notes||'________']
  };
 });
 const signatures='Entrega / firma ________________________    Recibe / firma ________________________';
 download('salida-y-recibo-herramental',createTablePDF({
  title:'Salida de herramental',
  columns:cols(['Fecha','Herramental','Código','No. de serie','Medidas','No. TH','Metros','Motivo de salida'],[76,75,79,85,120,56,72,108]),
  rows:data.map(item=>item.out),summary:signatures,
  sections:[{title:'Entrada de herramental · checklist',continuePage:true,columns:cols(['Fecha','Herramental','Código','No. de serie','Medidas','No. TH','Metros','Engrane OK','Material','¿Pasa?','Estado de entrada'],[57,57,63,67,83,43,65,67,69,66,89]),
   rows:data.map(item=>item.back),summary:signatures}]
 }));
}
export function mountPlantControls(root,{request,aniloxCleaning,recordResharpen,show,toast,view,mayEdit,inkLots,products=[],creases=[],order=null}){
 const api=(operation,payload={})=>request({operation,...payload});
 let alertOnly=false;
 const fail=error=>toast(error.message);
 const loading=()=>{root.innerHTML='<p class="notice">Cargando…</p>';};
 const mounted=()=>root.isConnected;

 async function stock(){
  loading();
  const {inks,days}=await api('ink_list');
  if(!mounted())return;
  const recommendations=inkRecommendations(inks,days);
  const alerts=recommendations.filter(ink=>ink.alert&&!ink.ordered_at);
  root.innerHTML=`<div class="panel-heading"><h2>Clasificación y stock de tintas</h2><p>Consumo de órdenes confirmadas y mezclas Pantone de ${days} días. Mínimo: demanda durante entrega y seguridad. Máximo: mínimo más demanda entre revisiones.</p></div>
   <div class="toolbar">${button(alertOnly?'Ver todas':'Por pedir ('+alerts.length+')','filter')}${button('Estimar consumo por NP','forecast')}${mayEdit&&alerts.length?button('Redactar correo de insumos','email_all'):''}</div>
   ${alerts.length?`<p class="notice">${alerts.length} tintas llegaron o se acercan al mínimo. El aviso sigue visible hasta marcar el pedido.</p>`:''}
   ${table(['TINTA','CLASE','CONSUMO','EXISTENCIA','MÍNIMO','INTERMEDIO','MÁXIMO','COMPRA','ACCIONES'],
    (alertOnly?alerts:recommendations).map(i=>row([i.code+' · '+i.name,(i.category||i.suggestion)+(i.category?'':' sugerida'),kg(i.consumed),kg(i.on_hand),
     i.consumed?kg(i.minimum):'Sin historial',i.consumed?kg(i.middle):'—',i.consumed?kg(i.maximum):'—',i.ordered_at?'Pedido registrado':i.alert?'Por pedir':'—'],
     button('Historial','history',i.id)+(mayEdit?button('Ajustar','settings',i.id)+button('Medir','measure',i.id)+button('Redactar correo','email',i.id)+(i.alert||i.ordered_at?button(i.ordered_at?'Reactivar aviso':'Ya pedí','ordered',i.id):''):''))))}`;
  root.onclick=event=>{
   const control=event.target.closest('[data-plant-action]');
   if(!control)return;
   const i=recommendations.find(ink=>String(ink.id)===control.dataset.value);
   const action=control.dataset.plantAction;
   if(action==='filter'){alertOnly=!alertOnly;stock().catch(fail);}
   if(action==='forecast')forecast().catch(fail);
   if(action==='email')purchaseDraft([i]);
   if(action==='email_all')purchaseDraft(alerts);
   if(action==='history')history(i).catch(fail);
   if(action==='ordered')show(i.ordered_at?'Reactivar aviso':'Marcar tinta pedida',esc(i.name),'<p>Confirma el estado de compra de esta tinta.</p>','Confirmar',async()=>{
    await api('ink_ordered',{id:i.id,ordered:!i.ordered_at});await stock();
   });
   if(action==='settings')show('Ajustar clasificación y stock',esc(i.name),`<div class="form-grid">${select('Clase','category',[['','Automática'],['A','A · Mayor consumo'],['B','B · Consumo regular'],['C','C · Poco consumo']],i.category)}
    ${select('Indispensable','indispensable',[['false','No'],['true','Sí']],String(i.indispensable))}
    ${field('Entrega (días)','lead_days',i.lead_days,'number','required min="1" max="365"')}
    ${field('Revisión (días)','review_days',i.review_days,'number','required min="1" max="365"')}
    ${field('Seguridad (días)','safety_days',i.safety_days,'number','required min="0" max="365"')}</div>`,'Guardar',async form=>{
    await api('ink_settings',{id:i.id,...Object.fromEntries(form)});await stock();
   });
   if(action==='measure')show('Registrar parámetros',esc(i.name),`<div class="form-grid">${select('Lote','lot_id',[['','Sin lote'],...inkLots.filter(l=>l.product_id===i.id).map(l=>[l.id,l.lot])])}
    ${field('Viscosidad','viscosity','','number','min="0.001" step="any"')}
    ${field('Unidad de viscosidad','viscosity_unit','','text','maxlength="30" placeholder="p. ej. s · Copa Zahn 2"')}
    ${field('pH','ph','','number','min="0" max="14" step="any"')}${field('Secado','drying','','text','maxlength="200"')}
    ${field('Observaciones','note','','text','maxlength="1000"')}</div>`,'Guardar',async form=>{
    await api('ink_measure',{id:i.id,...Object.fromEntries(form)});toast('Parámetros registrados.');
   });
  };
 }
 async function history(ink){
  const data=await api('ink_history',{id:ink.id});
  show('Historial de tinta',esc(ink.name),`<h3>Consumo confirmado</h3>
   ${table(['FECHA','ORDEN','NP','GRAMOS','METROS'],data.consumption.map(item=>row([item.day,item.folio,item.np,n(item.grams),n(item.meters)])))}
   ${data.mixtures.length?`<h3>Consumo en mezclas Pantone</h3>${table(['FECHA','MEZCLA','GRAMOS'],data.mixtures.map(item=>row([item.date,item.reason,n(item.grams)]))) }`:''}
   ${data.other_outflows.length?`<h3>Otras salidas de inventario</h3>${table(['FECHA','MOTIVO','GRAMOS'],data.other_outflows.map(item=>row([item.date,item.reason,n(item.grams)]))) }`:''}
   <h3>Parámetros de control</h3>${table(['FECHA','LOTE','VISCOSIDAD','PH','SECADO','OBSERVACIONES'],data.parameters.map(item=>row([item.recorded_at.slice(0,10),item.lot,[item.viscosity,item.viscosity_unit].filter(Boolean).join(' '),item.ph,item.drying,item.note]))) }`);
 }
 function purchaseDraft(items){
  show('Correo para pedir insumos','Captura los kg de cada tinta que vas a solicitar.',
   items.map(item=>field(item.code+' · '+item.name,'kg_'+item.id,'','number','min="0" step="0.001" inputmode="decimal"')).join('')+
   '<div class="actions"><button type="button" class="btn primary" id="plant-draft">Redactar correo</button><button type="button" class="btn" id="plant-copy" hidden>Copiar correo</button></div><label class="field" id="plant-draft-text" hidden>Asunto y mensaje<textarea rows="10"></textarea></label><p id="plant-draft-status" role="status"></p>');
  const form=document.querySelector('#modal form'),draft=form.querySelector('#plant-draft-text'),copy=form.querySelector('#plant-copy'),status=form.querySelector('#plant-draft-status');
  form.querySelector('#plant-draft').onclick=()=>{
   if(!form.reportValidity())return;
   const values=new FormData(form);
   const lines=items.map(item=>({...item,kg:Number(values.get('kg_'+item.id)),provider:products.find(product=>product.id===item.id)?.provider})).filter(item=>item.kg>0);
   if(!lines.length){status.textContent='Captura una cantidad mayor que cero.';return;}
   const email=supplyEmail(lines);
   draft.querySelector('textarea').value='Asunto: '+email.subject+'\n\n'+email.body;
   draft.hidden=false;copy.hidden=false;status.textContent='';
  };
  copy.onclick=async()=>{
   const area=draft.querySelector('textarea');
   try{await navigator.clipboard.writeText(area.value);status.textContent='Correo copiado.';}
   catch{area.focus();area.select();status.textContent='El texto está seleccionado para copiar.';}
  };
 }
 async function forecast(){
  const {parts}=await api('forecast_parts');
  show('Estimar consumo','Historial de corridas por número de parte',
   field('Buscar NP o producto','part_search','','search','autocomplete="off"')+
   select('Número de parte','code',[['','Selecciona un NP']],'','required size="6"')+
   select('Producto','product',[['','Selecciona un producto']],'')+
   field('Metros previstos','meters','','number','required min="0.01" step="any"')+'<div id="plant-forecast"></div>');
  const form=document.querySelector('#modal form'),np=form.elements.code,product=form.elements.product;
  const updateProducts=()=>{
   const names=parts.find(part=>part.code===np.value)?.names||[];
   product.required=names.length>1;product.disabled=!product.required;
   product.closest('label').hidden=!product.required;
   product.innerHTML=options([['','Selecciona un producto'],...names.map(name=>[name,name])],'');
  };
  const filter=()=>{
   const query=form.elements.part_search.value.trim().toLowerCase();
   const found=parts.filter(part=>[part.code,...part.names].some(value=>value.toLowerCase().includes(query)));
   np.innerHTML=options([['','Selecciona un NP'],...found.map(part=>[part.code,part.code+' · '+part.names.join(' / ')])],np.value);
   if(query&&found.length===1)np.value=found[0].code;
   updateProducts();
  };
  form.elements.part_search.oninput=filter;np.onchange=updateProducts;filter();
  const run=document.createElement('button');run.className='btn';run.type='button';run.textContent='Calcular';
  const result=form.querySelector('#plant-forecast');result.before(run);
  run.onclick=async()=>{
   if(!form.reportValidity())return;
   try{
    const {estimates}=await api('forecast',Object.fromEntries(new FormData(form)));
    result.innerHTML=estimates.length?table(['TINTA','CORRIDAS','ESTIMACIÓN (g)','ESTIMACIÓN (kg)'],estimates.map(item=>row([item.name,item.orders,n(item.estimated_grams),kg(item.estimated_grams)]))):'<p class="notice">No hay corridas confirmadas con metros para ese NP.</p>';
   }catch(error){result.textContent=error.message;}
  };
 }

 async function tools(){
  loading();
  const dies=view==='herramental';
  const [data,cleaning]=await Promise.all([api('tools'),dies?null:aniloxCleaning({operation:'list'})]);
  if(!mounted())return;
  const kind=dies?'die':'anilox', items=dies?data.dies:data.anilox;
  const cleanings=new Map((cleaning?.cleanings||[]).map(item=>[item.code,item]));
  const alerts=data.services.filter(item=>item.kind===kind&&!item.received_on&&item.due_on<=data.today);
  const range=item=>n(item.cycle_meters)+' / 50,000 m';
  const operations=(item)=>mayEdit?button('Editar','edit',item.code)+(dies?(item.regrinds<6?button('Registrar reafile realizado','record-regrind',item.code):''):button('Registrar limpieza','clean',item.code)):'—';
  const notices=dies?items.filter(item=>item.regrinds>=5||item.cycle_meters>=50000).map(item=>`${item.code}: ${item.regrinds>=6?'límite de seis reafiles alcanzado':item.regrinds===5?'pedir reemplazo':range(item)+' · evaluar reafile'}`):[];
  root.innerHTML=`<div class="panel-heading"><h2>${dies?'Suajes · reafile y mantenimiento':'Catálogo de anilox'}</h2></div>
   <div class="toolbar">${mayEdit?button('Programar mantenimiento o auditoría','schedule')+(dies?button('Generar PDF de reafile','send'):button('Nuevo anilox','edit')):''}
   ${dies?'<label>Buscar suaje <input type="search" id="plant-tool-search"></label>':'<label>Buscar anilox <input type="search" id="plant-tool-search"></label>'}</div>
   ${alerts.length?`<p class="notice">${alerts.length} servicios pendientes en la fecha programada o vencidos.</p>`:''}
   ${notices.length?`<details><summary>${notices.length} avisos de suajes</summary><ul>${notices.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></details>`:''}
   <div id="plant-tool-table"></div><div class="panel-heading"><h2>Historial de servicios</h2></div>
   ${table(['CÓDIGO','SERVICIO','PROGRAMADO / SALIDA','RECEPCIÓN','ACCIONES'],data.services.filter(s=>s.kind===kind).map(s=>row([s.code,({audit:'Auditoría',maintenance:'Mantenimiento',resharpen:'Reafile'})[s.service],s.due_on,s.received_on||'Pendiente'],
    (s.service==='resharpen'&&s.sent_on?button('PDF','pdf',s.id):'')+(!s.received_on&&mayEdit?button(s.service==='resharpen'?'Recibir':'Cerrar servicio','receive',s.id):'')||'—')))}`;
  const list=root.querySelector('#plant-tool-table');
  const printRows=search=>{
   const matching=items.filter(item=>(item.code+' '+(item.name||'')).toLowerCase().includes(search.toLowerCase()));
   list.innerHTML=dies?table(['SUAJE','SERIE','TH','REAFILADOS','METROS DEL CICLO','ACCIONES'],matching.map(item=>row([item.code,item.details.serial,item.details.th,item.regrinds,range(item)],operations(item))))
    :table(['ANILOX','LINEAJE','BCM','APORTE REAL','MATERIAL','DENSIDAD','ÚLTIMA LIMPIEZA','PRÓXIMA LIMPIEZA','NOTAS','ACCIONES'],matching.map(item=>{const cleaning=cleanings.get(item.code);return row([item.code,item.lpi,item.bcm,item.actual,item.material,item.density,cleaning?.last||'Por registrar',cleaning?.next?(cleaning.next+(cleaning.next<data.today?' · Vencida':cleaning.next===data.today?' · Hoy':'')):'—',item.notes],operations(item));}));
  };
  printRows('');
  root.querySelector('#plant-tool-search').oninput=event=>printRows(event.target.value);
  root.onclick=event=>{
   const control=event.target.closest('[data-plant-action]');
   if(!control)return;
   const {plantAction:action,value}=control.dataset;
   if(action==='edit')editTool(kind,items.find(item=>item.code===value),tools);
   if(action==='record-regrind')show('Registrar reafile realizado',esc(value),
    field('Fecha de recepción','received_on',data.today,'date',`required max="${esc(data.today)}"`)+field('Observaciones','notes','','text','maxlength="1000"'),
    'Guardar',async form=>{
     await recordResharpen({code:value,...Object.fromEntries(form)});await tools();
    });
   if(action==='clean')show('Registrar limpieza',esc(value),
    field('Fecha de limpieza','cleaned_on',data.today,'date',`required max="${esc(data.today)}"`)+field('Observaciones','notes','','text','maxlength="1000"'),
    'Guardar',async form=>{
     await aniloxCleaning({operation:'save',code:value,...Object.fromEntries(form)});await tools();
    });
   if(action==='schedule')schedule(kind,items,data.today,tools);
   if(action==='send')printRegrind(items,data.today);
   if(action==='receive')receive(data.services.find(item=>String(item.id)===value),data.today,tools);
   if(action==='pdf'){
    const target=data.services.find(item=>String(item.id)===value);
    regrindPDF(data.services.filter(item=>target.batch_id?item.batch_id===target.batch_id:item===target));
   }
  };
 }
 function editTool(kind,item,refresh){
  const die=kind==='die',base=die?item.details:(item||{}),code=item?.code||'';
  const textFields=die?{serial:'Número de serie',th:'TH',axis_measure:'Medida al eje',development_measure:'Medida en desarrollo',material:'Material',liner:'Liner',notes:'Notas'}
   :{material:'Material',notes:'Notas'};
  const numeric=die?{initial_regrinds:'Reafilados previos al registro',initial_cycle_meters:'Metros previos del ciclo'}
   :{lpi:'Lineaje (LPI)',bcm:'BCM',actual:'Aporte real',density:'Densidad'};
  show(die?'Editar suaje':'Ficha de anilox',esc(code),`<div class="form-grid">${code?'':field('Código AX','code','','text','required pattern="AX[1-9][0-9]*"')}
   ${Object.entries(numeric).map(([key,label])=>field(label,key,base[key]??(die?0:''),'number',key==='initial_regrinds'?'min="0" max="6" step="1"':'min="0" step="any"')).join('')}
   ${die?field('Fecha de inicio del ciclo registrado','initial_cycle_date',base.initial_cycle_date||'','date'):''}
   ${Object.entries(textFields).map(([key,label])=>field(label,key,base[key]||'','text','maxlength="1000"')).join('')}</div>`,'Guardar',async form=>{
   const values=Object.fromEntries(form);
   delete values.code;
   for(const key of Object.keys(numeric))if(values[key]==='')delete values[key];
   if(values.initial_cycle_date==='')delete values.initial_cycle_date;
   const details={...base,...values};
   for(const key of Object.keys(numeric))if(!form.get(key))delete details[key];
   delete details.code;
   if(details.initial_cycle_date==='')delete details.initial_cycle_date;
   await api('save_catalog',{kind,code:code||form.get('code'),details});await refresh();
  });
 }
 const toolChecks=items=>items.map(item=>`<label data-tool-choice><input type="checkbox" name="code" value="${esc(item.code)}"> ${esc(item.code)} ${esc(item.name||'')}</label><br>`).join('');
 function printRegrind(dies,today){
  const meters=new Map(creases.map(group=>[group.code,group.meters]));
  const byCode=new Map([...dies,...products.filter(product=>product.category==='herramental'&&product.code.startsWith('PD')).map(plate=>({
   ...plate,details:plate.tooling_details||{},cycle_meters:meters.get(plate.code)??null
  }))].map(item=>[item.code,item]));
  show('Ficha de entrada y salida','Selecciona los suajes o plecas que van a reafile.',
   field('Fecha de salida','date',today,'date','required')+field('Buscar código o nombre','filter','','search','autocomplete="off"')+
   '<div style="max-height:260px;overflow:auto">'+toolChecks([...byCode.values()])+'</div>','Generar PDF',async form=>{
    const codes=form.getAll('code');
    if(!codes.length)throw Error('Selecciona al menos un suaje o una pleca.');
    regrindPDF(codes.map(code=>({code,sent_on:form.get('date'),snapshot:byCode.get(code)})));
    toast('Ficha descargada.');
   });
  const form=document.querySelector('#modal form');
  form.elements.filter.oninput=event=>{
   const query=event.target.value.trim().toLowerCase();
   for(const label of form.querySelectorAll('[data-tool-choice]'))label.hidden=!label.textContent.toLowerCase().includes(query);
  };
 }
 function schedule(kind,items,today,refresh){
  show('Programar servicio','Selecciona uno o varios herramentales',
   `<div class="form-grid">${select('Servicio','service',[['maintenance','Mantenimiento'],['audit','Auditoría']])}
   ${field('Fecha programada','due_on',today,'date','required')}</div>
   <details open><summary>Herramentales</summary><div style="max-height:260px;overflow:auto">${toolChecks(items)}</div></details>`,
   'Guardar',async form=>{
    const codes=form.getAll('code');
    if(!codes.length)throw Error('Selecciona al menos un herramental.');
    await api('service_batch',{kind,service:form.get('service'),codes,due_on:form.get('due_on')});await refresh();
   });
 }
 function receive(service,today,refresh){
  const regrind=service.service==='resharpen';
  const checks=[['','Selecciona'],['yes','Sí'],['no','No']];
  show(regrind?'Recibir suaje':'Cerrar servicio',esc(service.code),
   `<div class="form-grid">${field('Fecha','received_on',today,'date','required')}${field('Quién recibe','received_by','','text','required')}
   ${regrind?select('Engrane OK','gear',checks,'','required')+field('Material','material','','text','required')+select('¿Pasa la prueba?','passes',checks,'','required'):''}
   ${field('Observaciones','notes')}</div>`,'Guardar',async form=>{
    await api('complete_service',{id:service.id,...Object.fromEntries(form)});await refresh();
   });
 }
 async function recipes(){
  if(order){await recipe({order_id:order.id});return;}
  loading();
  const {parts}=await api('parts');
  if(!mounted())return;
  root.innerHTML=`<div class="panel-heading"><h2>Recetas por número de parte</h2></div><form class="toolbar" id="plant-recipe-search">
   ${field('NP','code','','text','list="recipe-np-list" required')}${field('Producto (si el NP está repetido)','product','','text','list="recipe-product-list"')}${button('Abrir receta','recipe')}
   <datalist id="recipe-np-list">${parts.map(part=>`<option value="${esc(part.code)}">${esc(part.names.join(' / '))}</option>`).join('')}</datalist><datalist id="recipe-product-list"></datalist></form>`;
  const form=root.querySelector('form');
  form.elements.code.onchange=()=>{
   const list=form.querySelector('#recipe-product-list');
   list.replaceChildren(...(parts.find(part=>part.code===form.elements.code.value.trim().toUpperCase())?.names||[]).map(name=>{
    const option=document.createElement('option');option.value=name;return option;
   }));
  };
  form.onsubmit=event=>{event.preventDefault();if(form.reportValidity())recipe(Object.fromEntries(new FormData(form))).catch(fail);};
  root.onclick=event=>{if(event.target.closest('[data-plant-action=recipe]'))form.requestSubmit();};
 }
 async function recipe(args){
  const {code,product,recipe:saved,anilox,order:source,reference}=await api('recipe',args);
  if(!code)throw Error('La orden no tiene NP.');
  const seeds=reference?.inks||source?.inks||[];
  const plan=source?.specifications?.production_plan;
  const withoutInk=plan?.production_type==='cut'||plan?.white_process==='material';
  const stations=Array.from({length:Math.max(6,...(saved?.stations||[]).map(i=>i.slot),...seeds.map(i=>i.slot))},(_,i)=>{
   const previous=saved?.stations?.find(station=>station.slot===i+1)||{};
   const observed=seeds.find(station=>station.slot===i+1);
   if(!observed&&!withoutInk)return {slot:i+1,...previous};
   const family=observed?.ink_family||observed?.kind||'',color=observed?.name||observed?.pantone||'';
   if(!source)return {slot:i+1,...previous,family:previous.family||family,color:previous.color||color,plate:previous.plate||reference?.plates||''};
   return {slot:i+1,...(previous.color===color&&previous.family===family?previous:{}),family,color,plate:previous.plate||reference?.plates||''};
  });
  const top={...Object.fromEntries(Object.entries(reference||{}).filter(([key,value])=>typeof value==='string'&&key!=='folio')),
   ...Object.fromEntries(Object.entries(saved||{}).filter(([,value])=>value!==''&&value!=null))};
  top.product ||= source?.product||product||'';
  top.machine ||= source?.machine||'';
  top.pressman ||= source?.pressman||'';
  top.die ||= source?.specifications?.suaje||'';
  top.crease ||= source?.specifications?.pleca||'';
  if(!top.notes&&reference?.colors_text)top.notes='Colores registrados sin posición: '+reference.colors_text;
  const topFields={product:'Producto',machine:'Prensa',pressman:'Prensista',die:'Suaje',crease:'Pleca',measure:'Medida',material:'Material',priority:'Prioridad',version:'Versión',...recipeFields};
  show('Receta de producción',esc(code+(source?.folio?' · '+source.folio:'')),`<div class="form-grid">${reference?.folio?`<p class="form-hint full">Datos disponibles de la orden ${esc(reference.folio)}.</p>`:''}${Object.entries(topFields).map(([name,label])=>field(label,name,top[name]||'','text','maxlength="250"')).join('')}</div>
   <h3>Estaciones</h3>${stations.map(station=>`<fieldset><legend>Estación ${station.slot}</legend><div class="form-grid">${Object.entries(stationFields).map(([name,label])=>
     name==='anilox'?select(label,'station_'+station.slot+'_'+name,[['','Sin asignar'],...anilox.map(ax=>[ax.code,`${ax.code} · ${ax.lpi} LPI · ${ax.bcm} BCM`])],station[name]):
     field(label,'station_'+station.slot+'_'+name,station[name]||'','text','maxlength="100"')).join('')}</div></fieldset>`).join('')}
   <div class="actions">${button('Descargar receta PDF','recipe_pdf')}</div>`,mayEdit?'Guardar receta':'',async form=>{
    await api('save_catalog',{kind:'recipe',code,product,...(source?.id?{order_id:source.id}:{}),details:readRecipe(form)});toast('Receta guardada para '+code+'.');
   });
  const dialog=document.querySelector('#modal');
  dialog.classList.add('wide-modal');
  function readRecipe(form){
   return {...Object.fromEntries(Object.keys(topFields).map(key=>[key,form.get(key)])),stations:stations.map(({slot})=>({
    slot,...Object.fromEntries(Object.keys(stationFields).map(key=>[key,form.get('station_'+slot+'_'+key)]))
   }))};
  }
  dialog.querySelector('[data-plant-action=recipe_pdf]').onclick=()=>{
   const values=readRecipe(new FormData(dialog.querySelector('form')));
   const head=['Estación',...Object.values(stationFields)];
   const rows=values.stations.map(station=>[station.slot,...Object.keys(stationFields).map(key=>{
    const ax=key==='anilox'?anilox.find(item=>item.code===station.anilox):null;
    return ax?`${ax.code} · ${ax.lpi} LPI · ${ax.bcm} BCM`:station[key];
   })]);
   const notes=['NP '+code,source?.folio&&'Orden '+source.folio,...Object.entries(topFields).filter(([key])=>values[key]).map(([key,label])=>label+' · '+values[key])].filter(Boolean);
   download('receta-'+code,createTablePDF({title:'Estándares de producción',notes,columns:cols(head,[44,62,69,88,68,44,58,60,48,57,45,45]),rows,
    summary:'Muestra física __________________________     Encargado de producción __________________     Preprensa __________________     Prensista __________________     Calidad __________________'}));
  };
 }
 ({stock,recetas:recipes,herramental:tools,anilox:tools}[view]||recipes)().catch(error=>{
  if(mounted()&&!order)root.innerHTML=`<p class="notice">${esc(error.message)}</p>`;
  else fail(error);
 });
}

export function mountQuickCapture(root,{request,toast,onSaved}){
 root.innerHTML='<p class="notice">Cargando catálogo…</p>';
 request({operation:'catalog'}).then(({today,parts,tools})=>{
  if(!root.isConnected)return;
  root.innerHTML=`<div class="panel-heading"><div><h2>Captura rápida privada</h2><p>Entrada programada para ${esc(today)}. La orden aparecerá en preparación.</p></div></div>
   <form class="device-settings" autocomplete="off"><div class="form-grid">
    ${field('Número de orden','folio','','text','required maxlength="100"')}
    ${select('NP · producto','part',[['','Selecciona un NP'],...parts.flatMap(part=>part.names.map(name=>[JSON.stringify([part.code,name]),part.code+' · '+name]))],'','required')}
    ${field('Colores','colors','','text','maxlength="1000" placeholder="Deja vacío si no lleva impresión"')}
    ${select('Suaje','die_id',[['','Sin suaje'],...tools.map(item=>[item.id,item.code+' · '+item.name])])}
    ${field('Metros','meters','','number','required min="0.001" step="0.001"')}
    ${field('Hora de entrada','scheduled_start','','time','required')}
   </div><div class="actions"><button class="btn primary">Enviar a preparación</button><a class="btn" href="#preparacion">Ver preparación</a></div>
   <p class="form-error" role="alert" hidden></p></form>`;
  const form=root.querySelector('form'),submit=form.querySelector('button'),error=form.querySelector('[role=alert]');
  form.onsubmit=async event=>{
   event.preventDefault();submit.disabled=true;error.hidden=true;
   try{
    const {part,...values}=Object.fromEntries(new FormData(form));
    const [np,product]=JSON.parse(part);
    const saved=await request({operation:'submit',...values,np,product});
    toast('Orden '+saved.folio+' enviada a preparación.');
    await onSaved(saved);
   }catch(problem){error.textContent=problem.message;error.hidden=false;submit.disabled=false;}
  };
 }).catch(error=>{if(root.isConnected)root.textContent=error.message;});
}

export function mountProductionSemester(root,{request,show,toast,today,admin}){
 const year=today.slice(0,4),half=Number(today.slice(5,7))<=6?'1':'2';
 root.innerHTML=`<div class="panel-heading"><div><h2>Corte semestral de producción</h2><p>Tiempos de corridas concluidas en el período, en minutos.</p></div></div>
  <form class="toolbar">${field('Año','year',year,'number','required min="2000" max="2100"')}${select('Semestre','semester',[['1','Enero a junio'],['2','Julio a diciembre']],half)}
  <button class="btn">Consultar</button></form><div id="semester-result"></div>`;
 const form=root.querySelector('form'),result=root.querySelector('#semester-result');
 const min=seconds=>seconds==null?'—':n(Number(seconds)/60);
 const headers=['FECHA','ORDEN','NP','RESPONSABLE','TOTAL (min)','EFECTIVO (min)','PAROS (min)','METROS'];
 const rows=records=>records.map(r=>{
  const m=r.metrics||{},stopped=m.gross_seconds!=null&&m.net_seconds!=null?Math.max(0,m.gross_seconds-m.net_seconds):null;
  return [r.report_date,r.folio,r.np,r.responsible_name,min(m.gross_seconds),min(m.net_seconds),min(stopped),n(m.actual_meters)];
 });
 let requestVersion=0;
 async function refresh(values){
  const current=++requestVersion;
  result.innerHTML='<p class="notice">Calculando…</p>';
  try{
   const report=await request({operation:'get',...values});
   if(current!==requestVersion||!result.isConnected)return;
   const records=report.records,withTime=records.filter(item=>item.metrics?.net_seconds!=null);
   const total=key=>withTime.reduce((sum,item)=>sum+Number(item.metrics?.[key]??0),0);
   const summary=`${records.length} corridas · ${withTime.length} con tiempo medido · ${min(total('net_seconds'))} min efectivos`;
   result.innerHTML=`<p class="notice">${esc(report.starts_on)} a ${esc(report.ends_on)} · ${report.closed?'Corte guardado':'Vista previa'} · ${esc(summary)}</p>
    <div class="toolbar">${records.length?button('Descargar PDF','pdf'):''}${admin&&report.can_close&&!report.closed&&records.length?button('Guardar corte definitivo','close'):''}</div>
    ${records.length?table(headers,rows(records).map(values=>row(values))):'<p class="notice">No hay corridas concluidas en este semestre.</p>'}`;
   result.querySelector('[data-plant-action=pdf]')?.addEventListener('click',()=>download('corte-produccion-'+report.starts_on,createTablePDF({
    title:'Corte semestral de producción',notes:[report.starts_on+' a '+report.ends_on,report.closed?'Corte guardado':'Vista previa'],
    columns:cols(headers,[78,102,75,116,75,75,75,70]),rows:rows(records),summary
   })));
   result.querySelector('[data-plant-action=close]')?.addEventListener('click',()=>show('Guardar corte definitivo',esc(report.starts_on+' a '+report.ends_on),
    '<p>Se guardará una copia de los tiempos de producción de este semestre.</p>','Guardar corte',async()=>{
     await request({operation:'close',...values});await refresh(values);toast('Corte semestral guardado.');
    }));
  }catch(error){if(current===requestVersion)result.textContent=error.message;}
 }
 form.onsubmit=event=>{event.preventDefault();refresh(Object.fromEntries(new FormData(form)));};
 refresh({year,semester:half});
}
