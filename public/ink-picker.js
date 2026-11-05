export function mountInkPicker(root,machine,initialProducts){
 let products=initialProducts,count=1;const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const current=()=>[...root.querySelectorAll('[data-ink-slot]')].map(el=>{const value=el.querySelector('select').value;return {slot:Number(el.dataset.inkSlot),product_id:value&&value!=='pantone'?Number(value):null,pantone:value==='pantone'?el.querySelector('input').value.trim():''};}).filter(i=>i.product_id||i.pantone);
 const describe=p=>`${p.name} · ${p.code} · ${p.provider} — ${p.available?'Disponible':'Sin existencia'}`;
 function changed(){for(const el of root.querySelectorAll('[data-ink-slot]')){const select=el.querySelector('select'),input=el.querySelector('input'),hint=el.querySelector('small');input.hidden=select.value!=='pantone';input.required=select.value==='pantone';const p=products.find(p=>p.id===Number(select.value));hint.textContent=select.value==='pantone'?'Se enviará una solicitud para preparar este Pantone.':p?(p.available?'Hay tinta en inventario.':'Sin existencia: la orden se puede solicitar, pero requiere abastecimiento.'):'Posición sin utilizar.';hint.className=p&&!p.available?'unavailable':'';}
  const items=current();root.closest('form').elements.colors.value=items.map(i=>i.pantone?'Pantone '+i.pantone:products.find(p=>p.id===i.product_id)?.name||'').join(' · ');
 }
 function render(saved=current()){
  if(machine.value.startsWith('Comco'))count=6;else count=Math.max(1,Math.min(12,count));
  root.innerHTML=`<div class="ink-slots">${Array.from({length:count},(_,n)=>`<label data-ink-slot="${n+1}">Color ${n+1}<select aria-label="Color ${n+1}"><option value="">Sin utilizar</option>${products.map(p=>`<option value="${p.id}">${esc(describe(p))}</option>`).join('')}<option value="pantone">Pantone / solicitar color nuevo…</option></select><input type="text" maxlength="100" placeholder="Pantone, por ejemplo 332 C" aria-label="Pantone ${n+1}" hidden><small></small></label>`).join('')}</div>${!machine.value.startsWith('Comco')&&count<12?'<button type="button" data-add-color>Agregar otra posición</button>':''}`;
  for(const item of saved){const el=root.querySelector(`[data-ink-slot="${item.slot}"]`);if(el){el.querySelector('select').value=item.pantone?'pantone':String(item.product_id);el.querySelector('input').value=item.pantone||'';}}
  root.querySelector('[data-add-color]')?.addEventListener('click',()=>{count++;render();});changed();
 }
 root.addEventListener('change',changed);root.addEventListener('input',changed);machine.addEventListener('change',()=>render());render();
 return {value:current,restore:items=>{if(Array.isArray(items)){count=Math.max(1,...items.map(i=>Number(i.slot)||1));render(items);}},reset:()=>{count=1;render([]);},update:newProducts=>{products=newProducts;for(const el of root.querySelectorAll('select'))for(const p of products){let option=[...el.options].find(o=>o.value===String(p.id));if(!option){option=new Option('',String(p.id));el.insertBefore(option,el.querySelector('[value=pantone]'));}option.textContent=describe(p);}changed();}};
}
