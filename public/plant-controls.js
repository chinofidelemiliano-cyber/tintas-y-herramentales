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
function regrindPDF(services){
 const data=services.map(({snapshot:s,code,sent_on,received_on,receipt})=>({
  out:[sent_on,code,s.details?.serial,s.details?.th,[s.details?.axis_measure,s.details?.development_measure].filter(Boolean).join(' × '),s.cycle_meters,s.deliverer,s.recipient],
  back:[received_on,code,s.details?.serial,s.details?.th,[s.details?.axis_measure,s.details?.development_measure].filter(Boolean).join(' × '),s.cycle_meters,
   receipt?.gear?receipt.gear==='yes'?'Sí':'No':'[ ] Sí   [ ] No',receipt?.material||'________',receipt?.passes?receipt.passes==='yes'?'Sí':'No':'[ ] Sí   [ ] No',receipt?.received_by||'________']
 }));
 download('salida-y-recibo-herramental',createTablePDF({
  title:'Salida de herramental para reafile',
  columns:cols(['Fecha','Suaje','Serie','TH','Medidas','Metros','Entrega','Recibe'],[76,75,85,49,124,83,105,105]),
  rows:data.map(item=>item.out),summary:'Firma de quien entrega ______________________    Firma de quien recibe ______________________',
  sections:[{title:'Recibo de herramental · checklist',continuePage:true,columns:cols(['Fecha','Suaje','Serie','TH','Medidas','Metros','Engrane OK','Material','¿Pasa?','Recibe'],[57,65,74,41,86,72,80,87,80,77]),
   rows:data.map(item=>item.back),summary:'Firma de recepción ______________________    Observaciones ____________________________________'}]
 }));
}
export function mountPlantControls(root,{request,show,toast,view,mayEdit,inkLots,order=null}){
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
   <div class="toolbar">${button(alertOnly?'Ver todas':'Por pedir ('+alerts.length+')','filter')}${button('Estimar consumo por NP','forecast')}</div>
   ${alerts.length?`<p class="notice">${alerts.length} tintas llegaron o se acercan al mínimo. El aviso sigue visible hasta marcar el pedido.</p>`:''}
   ${table(['TINTA','CLASE','CONSUMO','EXISTENCIA','MÍNIMO','INTERMEDIO','MÁXIMO','COMPRA','ACCIONES'],
    (alertOnly?alerts:recommendations).map(i=>row([i.code+' · '+i.name,(i.category||i.suggestion)+(i.category?'':' sugerida'),kg(i.consumed),kg(i.on_hand),
     i.consumed?kg(i.minimum):'Sin historial',i.consumed?kg(i.middle):'—',i.consumed?kg(i.maximum):'—',i.ordered_at?'Pedido registrado':i.alert?'Por pedir':'—'],
     button('Historial','history',i.id)+(mayEdit?button('Ajustar','settings',i.id)+button('Medir','measure',i.id)+(i.alert||i.ordered_at?button(i.ordered_at?'Reactivar aviso':'Ya pedí','ordered',i.id):''):''))))}`;
  root.onclick=event=>{
   const control=event.target.closest('[data-plant-action]');
   if(!control)return;
   const i=recommendations.find(ink=>String(ink.id)===control.dataset.value);
   const action=control.dataset.plantAction;
   if(action==='filter'){alertOnly=!alertOnly;stock().catch(fail);}
   if(action==='forecast')forecast();
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
 function forecast(){
  show('Estimar consumo', 'Historial de corridas por número de parte',field('Número de parte','code','','text','required')+field('Producto (si el NP está repetido)','product')+field('Metros previstos','meters','','number','required min="0.01" step="any"')+'<div id="plant-forecast"></div>');
  const form=document.querySelector('#modal form');
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
  const data=await api('tools');
  if(!mounted())return;
  const dies=view==='herramental',kind=dies?'die':'anilox', items=dies?data.dies:data.anilox;
  const alerts=data.services.filter(item=>item.kind===kind&&!item.received_on&&item.due_on<=data.today);
  const range=item=>n(item.cycle_meters)+' / 50,000 m';
  const operations=(item)=>mayEdit?button('Editar','edit',item.code):'—';
  const notices=dies?items.filter(item=>item.regrinds>=5||item.cycle_meters>=50000).map(item=>`${item.code}: ${item.regrinds>=6?'límite de seis reafiles alcanzado':item.regrinds===5?'pedir reemplazo':range(item)+' · evaluar reafile'}`):[];
  root.innerHTML=`<div class="panel-heading"><h2>${dies?'Suajes · reafile y mantenimiento':'Catálogo de anilox'}</h2></div>
   <div class="toolbar">${mayEdit?button('Programar mantenimiento o auditoría','schedule')+(dies?button('Enviar a reafile','send'):button('Nuevo anilox','edit')):''}
   ${dies?'<label>Buscar suaje <input type="search" id="plant-tool-search"></label>':'<label>Buscar anilox <input type="search" id="plant-tool-search"></label>'}</div>
   ${alerts.length?`<p class="notice">${alerts.length} servicios pendientes en la fecha programada o vencidos.</p>`:''}
   ${notices.length?`<details><summary>${notices.length} avisos de suajes</summary><ul>${notices.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></details>`:''}
   <div id="plant-tool-table"></div><div class="panel-heading"><h2>Historial de servicios</h2></div>
   ${table(['CÓDIGO','SERVICIO','PROGRAMADO / SALIDA','RECEPCIÓN','ACCIONES'],data.services.filter(s=>s.kind===kind).map(s=>row([s.code,({audit:'Auditoría',maintenance:'Mantenimiento',resharpen:'Reafile'})[s.service],s.due_on,s.received_on||'Pendiente'],
    (s.service==='resharpen'?button('PDF','pdf',s.id):'')+(!s.received_on&&mayEdit?button(s.service==='resharpen'?'Recibir':'Cerrar servicio','receive',s.id):'')||'—')))}`;
  const list=root.querySelector('#plant-tool-table');
  const printRows=search=>{
   const matching=items.filter(item=>(item.code+' '+(item.name||'')).toLowerCase().includes(search.toLowerCase()));
   list.innerHTML=dies?table(['SUAJE','SERIE','TH','REAFILADOS','METROS DEL CICLO','ACCIONES'],matching.map(item=>row([item.code,item.details.serial,item.details.th,item.regrinds,range(item)],operations(item))))
    :table(['ANILOX','LINEAJE','BCM','APORTE REAL','MATERIAL','DENSIDAD','NOTAS','ACCIONES'],matching.map(item=>row([item.code,item.lpi,item.bcm,item.actual,item.material,item.density,item.notes],operations(item))));
  };
  printRows('');
  root.querySelector('#plant-tool-search').oninput=event=>printRows(event.target.value);
  root.onclick=event=>{
   const control=event.target.closest('[data-plant-action]');
   if(!control)return;
   const {plantAction:action,value}=control.dataset;
   if(action==='edit')editTool(kind,items.find(item=>item.code===value),tools);
   if(action==='schedule'||action==='send')schedule(kind,items,data.today,action==='send',tools);
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
 function schedule(kind,items,today,resharpen,refresh){
  const eligible=resharpen?items.filter(item=>item.regrinds<6):items;
  show(resharpen?'Salida para reafile':'Programar servicio','Selecciona uno o varios herramentales',
   `<div class="form-grid">${resharpen?'':select('Servicio','service',[['maintenance','Mantenimiento'],['audit','Auditoría']])}
   ${field(resharpen?'Fecha de salida':'Fecha programada','due_on',today,'date','required')}
   ${resharpen?field('Quién entrega','deliverer','','text','required maxlength="200"')+field('Quién recibe','recipient','','text','required maxlength="200"'):''}</div>
   <details open><summary>Herramentales</summary><div style="max-height:260px;overflow:auto">${eligible.map(item=>`<label><input type="checkbox" name="code" value="${esc(item.code)}"> ${esc(item.code)} ${esc(item.name||'')}</label><br>`).join('')}</div></details>`,
   'Guardar',async form=>{
    const codes=form.getAll('code');
    if(!codes.length)throw Error('Selecciona al menos un herramental.');
    const response=await api('service_batch',{kind,service:resharpen?'resharpen':form.get('service'),codes,due_on:form.get('due_on'),deliverer:form.get('deliverer'),recipient:form.get('recipient')});
    if(resharpen)regrindPDF(response.services);
    await refresh();
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
  const {code,product,recipe:saved,anilox,order:source}=await api('recipe',args);
  if(!code)throw Error('La orden no tiene NP.');
  const seeds=source?.inks||[];
  const plan=source?.specifications?.production_plan;
  const withoutInk=plan?.production_type==='cut'||plan?.white_process==='material';
  const stations=Array.from({length:Math.max(6,...(saved?.stations||[]).map(i=>i.slot),...seeds.map(i=>i.slot))},(_,i)=>{
   const previous=saved?.stations?.find(station=>station.slot===i+1)||{};
   const observed=seeds.find(station=>station.slot===i+1);
   if(!source||(!seeds.length&&!withoutInk))return {slot:i+1,...previous};
   const family=observed?.ink_family||'',color=observed?.name||observed?.pantone||'';
   return {slot:i+1,...(previous.color===color&&previous.family===family?previous:{}),family,color};
  });
  const top={...saved,product:source?.product||product||saved?.product||'',machine:source?.machine||saved?.machine||'',pressman:source?.pressman||saved?.pressman||'',
   die:source?.specifications?.suaje||saved?.die||'',crease:source?.specifications?.pleca||saved?.crease||'',material:source?.specifications?.production_plan?.material_code||saved?.material||''};
  const topFields={product:'Producto',machine:'Prensa',pressman:'Prensista',die:'Suaje',crease:'Pleca',measure:'Medida',material:'Material',priority:'Prioridad',version:'Versión',...recipeFields};
  show('Receta de producción',esc(code+(source?.folio?' · '+source.folio:'')),`<div class="form-grid">${Object.entries(topFields).map(([name,label])=>field(label,name,top[name]||'','text','maxlength="250"')).join('')}</div>
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
