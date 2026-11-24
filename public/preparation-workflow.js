import {incidentClock} from './incident-photos.js';

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
 let active;
 let settings;
 function clear() {
  active = null;
  panel?.remove();
  panel = null;
 }
 function tick() {
  if (!active) return;
  const time = preparationTiming(active, active);
  panel.querySelector('[data-state]').textContent = preparationState(active,active);
  panel.querySelector('output').textContent = incidentClock(Math.floor(time.effective));
  const reminders = [];
  if (active.changed_at) reminders.push('La orden se modificó durante la preparación. Revisa el detalle.');
  if (active.estimated_minutes && time.effective >= active.estimated_minutes*60) reminders.push('Superó el tiempo estimado.');
  const threshold = [settings.second_minutes,settings.first_minutes].find(minutes => minutes && time.elapsed >= minutes*60);
  if (threshold) reminders.push(`Abierta hace ${threshold} minutos o más.`);
  if (settings.shift_end) {
   const wallTime = new Intl.DateTimeFormat('en-GB',{timeZone:timeZone(),hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
   if (wallTime.format(Date.now()) >= settings.shift_end.slice(0,5)) reminders.push('Preparación pendiente al finalizar la jornada.');
  }
  const message = reminders.join(' ');
  const reminder = panel.querySelector('[data-reminder]');
  if (reminder.textContent !== message) reminder.textContent = message;
 }
 function update(clocks,userId,reminders) {
  settings = reminders;
  const next = clocks.find(clock => clock.responsible === userId && !clock.closed_at && clock.started_at);
  if (!next) { clear(); return; }
  if (active?.order_id === next.order_id && active.version === next.version) { active = next; tick(); return; }
  clear();
  active = next;
  panel = document.createElement('aside');
  panel.className = 'panel preparation-float';
  panel.setAttribute('aria-label','Cronómetro de preparación');
  panel.innerHTML = '<strong></strong><output class="mono"></output><span data-state></span><p data-reminder role="status"></p><div class="actions"></div>';
  panel.querySelector('strong').textContent = 'Orden ' + next.folio;
  const pause = next.paused_at ? 'resume' : 'pause';
  for (const [label, action] of [[next.paused_at ? 'Reanudar' : 'Pausar',pause],['Finalizar','finish'],['Ver orden','open']]) {
   const button = document.createElement('button');
   button.type = 'button';
   button.className = 'btn';
   button.textContent = label;
   button.onclick = () => action === 'open' ? openOrder(next.order_id) : changeClock(next.order_id,action,button);
   panel.querySelector('.actions').append(button);
  }
  document.body.append(panel);
  tick();
 }
 setInterval(tick,1000);
 return {update, clear};
}
