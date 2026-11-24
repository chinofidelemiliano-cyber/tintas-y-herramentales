const minutesFormat = new Intl.NumberFormat('es-MX',{maximumFractionDigits:2});
export const preparationMinutesLabel = seconds => minutesFormat.format(Math.max(0,seconds)/60)+' min';

export function preparationWallTime(value,zone) {
 const date = new Date(value);
 if(!value||!Number.isFinite(date.getTime()))return '';
 const fields=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{
  timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(date).map(part=>[part.type,part.value]));
 return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}

function preparationInstant(value,original,zone) {
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('Selecciona una fecha y una hora válidas.');
 if(preparationWallTime(original,zone)===value)return Date.parse(original);
 const nominal=Date.parse(value+'Z');
 const offsets=new Set();
 for(const hours of [-24,0,24]){
  const sample=nominal+hours*3600000;
  offsets.add(Date.parse(preparationWallTime(sample,zone)+'Z')-sample);
 }
 const matches=[...offsets].map(offset=>nominal-offset).filter(stamp=>preparationWallTime(stamp,zone)===value);
 if(matches.length!==1)throw Error('Esa hora es ambigua o no existe en la zona del perfil. Selecciona otra hora.');
 return matches[0];
}

export function preparationCorrectionValues(values,original,zone,now=Date.now()) {
 const start=preparationInstant(values.started_at,original.started_at,zone);
 const seconds=key=>{
  const amount=Number(values[key]);
  if(values[key]===''||!Number.isFinite(amount)||amount<0)throw Error('Captura minutos válidos en cada campo.');
  return amount*60;
 };
 const paused=seconds('paused_minutes'),idle=seconds('idle_minutes');
 const byEnd=values.mode==='end';
 const effective=byEnd?(preparationInstant(values.ended_at,original.ended_at,zone)-start)/1000-paused-idle:seconds('effective_minutes');
 const total=effective+paused+idle;
 if(effective<0||total<=0)throw Error('El fin debe ser posterior al inicio y cubrir las pausas y el tiempo improductivo.');
 const end=start+total*1000;
 if(end>now)throw Error('El fin calculado está en el futuro. Revisa el inicio y los minutos.');
 return {started_at:new Date(start).toISOString(),ended_at:new Date(end).toISOString(),
  effective_seconds:effective,paused_seconds:paused,idle_seconds:idle};
}

export function preparationTiming(order, clock, now = Date.now()) {
 const start = Date.parse(clock?.correction?.started_at || order.started_at);
 const end = Date.parse(clock?.correction?.ended_at || order.ended_at || clock?.closed_at);
 const elapsed = Number.isFinite(start) ? Math.max(0, ((Number.isFinite(end) ? end : now) - start) / 1000) : 0;
 const pauseStart = Date.parse(clock?.paused_at);
 const paused = Number(clock?.correction?.paused_seconds ?? clock?.paused_seconds ?? 0)
  + (Number.isFinite(pauseStart) ? Math.max(0, (now - pauseStart) / 1000) : 0);
 return {
  elapsed,
  paused,
  effective: Number(clock?.correction?.effective_seconds ?? Math.max(0, elapsed - paused)),
  idle: Number(clock?.correction?.idle_seconds ?? 0)
 };
}

export function preparationState(order,clock) {
 if (order.status === 'cancelled') return 'Cancelada';
 if (clock?.handed_off_at) return 'Entregada a producción';
 if (order.ended_at || clock?.closed_at) return 'Preparada';
 if (!order.started_at) return 'Pendiente';
 if (clock?.paused_at) return 'En pausa';
 const items = clock?.items || [];
 if (items.some(item => item.status === 'review')) return 'En revisión técnica';
 if (items.some(item => item.status === 'unavailable')) return 'En espera de materiales';
 if (items.some(item => item.status === 'ready') && items.some(item => item.status !== 'ready')) return 'Preparación parcial';
 return 'En preparación';
}

export function createPreparationIndicator({changeClock,openOrder,timeZone}) {
 let panel;
 let floating;
 let floatingPanel;
 let active;
 let settings;
 let expanded=false;
 function clear() {
  active=null;
  panel?.remove();
  panel=null;
  floating?.close();
  floating=null;
  floatingPanel=null;
 }
 function tick() {
  if(!active)return;
  const time=preparationTiming(active,active);
  const reminders=[];
  if(active.changed_at)reminders.push('La orden se modificó durante la preparación. Revisa el detalle.');
  if(active.estimated_minutes&&time.effective>=active.estimated_minutes*60)reminders.push('Superó el tiempo estimado.');
  const threshold=[settings.second_minutes,settings.first_minutes].find(minutes=>minutes&&time.elapsed>=minutes*60);
  if(threshold)reminders.push(`Abierta hace ${threshold} minutos o más.`);
  if(settings.shift_end){
   const wallTime=new Intl.DateTimeFormat('en-GB',{timeZone:timeZone(),hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
   if(wallTime.format(Date.now())>=settings.shift_end.slice(0,5))reminders.push('Preparación pendiente al finalizar la jornada.');
  }
  const message=reminders.join(' ');
  for(const display of [panel,floatingPanel].filter(Boolean)){
   display.querySelector('[data-state]').textContent=preparationState(active,active)+(message&&display===panel&&!panel.open?' · Aviso':'');
   display.querySelector('output').textContent=preparationMinutesLabel(time.effective);
   const reminder=display.querySelector('[data-reminder]');
   if(reminder.textContent!==message)reminder.textContent=message;
  }
 }
 function build(doc,external=false){
  const display=doc.createElement(external?'section':'details');
  display.className=external?'preparation-external':'preparation-dock';
  display.setAttribute('aria-label','Cronómetro de preparación');
  if(!external){
   display.open=expanded;
   display.ontoggle=()=>{if(display.isConnected){expanded=display.open;tick();}};
  }
  const info=doc.createElement(external?'header':'summary');
  info.innerHTML='<strong></strong><output class="mono"></output><span data-state></span>';
  info.querySelector('strong').textContent='Orden '+active.folio;
  const actions=doc.createElement('div');
  actions.className='actions';
  const reminder=doc.createElement('p');
  reminder.dataset.reminder='';
  reminder.setAttribute('role','status');
  const error=doc.createElement('p');
  error.setAttribute('role','status');
  const controls=[
   [active.paused_at?'Reanudar':'Pausar',button=>changeClock(active.order_id,active.paused_at?'resume':'pause',button,error)],
   ['Finalizar',button=>changeClock(active.order_id,'finish',button,error)],
   ['Ver orden',()=>{window.focus();openOrder(active.order_id);}]
  ];
  if(!external&&window.documentPictureInPicture)controls.push(['Ventana flotante',async()=>{
   try{
    if(floating&&!floating.closed)return;
    const popup=await window.documentPictureInPicture.requestWindow({width:380,height:210});
    if(!active){popup.close();return;}
    floating=popup;
    popup.document.title='Preparación · Prisma';
    const style=popup.document.createElement('style');
    style.textContent=':root{color-scheme:light dark;font:15px system-ui}body{margin:14px}.preparation-external header,.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}output{font-weight:700}p{margin:6px 0}p:empty{display:none}button{font:inherit;padding:6px 9px;cursor:pointer}';
    popup.document.head.append(style);
    popup.addEventListener('pagehide',()=>{if(floating===popup){floating=null;floatingPanel=null;}},{once:true});
    renderFloating();
    tick();
   }catch{error.textContent='No se pudo abrir la ventana flotante. Prueba desde Microsoft Edge o Chrome.';}
  }]);
  for(const [label,action] of controls){
   const button=doc.createElement('button');
   button.type='button';
   button.className='btn';
   button.textContent=label;
   button.onclick=()=>action(button);
   actions.append(button);
  }
  display.append(info,actions,reminder,error);
  return display;
 }
 function renderFloating(){
  if(!floating||floating.closed)return;
  floatingPanel=build(floating.document,true);
  floating.document.body.replaceChildren(floatingPanel);
 }
 function update(clocks,userId,reminders){
  settings=reminders;
  const next=clocks.find(clock=>clock.responsible===userId&&!clock.closed_at&&clock.started_at);
  if(!next){clear();return;}
  const unchanged=panel&&active?.order_id===next.order_id&&active.version===next.version;
  active=next;
  if(!unchanged){
   panel?.remove();
   panel=build(document);
   document.querySelector('.topbar').after(panel);
   renderFloating();
  }
  tick();
 }
 setInterval(tick,1000);
 return {update,clear};
}
