import {decimalSum} from './quantity.js';
// Metres repeat on ink rows: one print run is counted only once per closed order.
export function dieUsage(orders,products=[]){
 const groups=new Map(),pending=[];
 for(const order of orders){
  if(order.status!=='confirmed')continue;
  const specs=order.specifications||{},product=products.find(p=>p.id===Number(specs.die_id)&&p.category==='herramental'&&/^SJ/i.test(p.code)),code=product?.code||String(specs.suaje||'').match(/\bSJ[\w-]+/i)?.[0]?.toUpperCase();
  const values=(order.lines||[]).map(l=>l.meters).filter(v=>v!==null&&v!==undefined&&v!==''),unique=[...new Set(values.map(Number))];
  const meters=unique.length===1&&Number.isFinite(unique[0])&&unique[0]>=0?unique[0]:null;
  if(!code||meters===null){pending.push({order,reason:!code?'Sin suaje SJ relacionado':unique.length>1?'Metros distintos entre renglones; requiere revisión':'Sin metros reales registrados'});continue;}
  if(!groups.has(code))groups.set(code,{code,name:product?.name||'',meters:0,runs:[]});
  const group=groups.get(code);group.runs.push({order,meters});group.meters=decimalSum([group.meters,meters]);
 }
 return {groups:[...groups.values()].sort((a,b)=>a.code.localeCompare(b.code,'es',{numeric:true})),pending};
}
