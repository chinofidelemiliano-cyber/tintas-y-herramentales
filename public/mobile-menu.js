// Mobile drawer: all dismissal paths share focus, scrolling and ARIA state.
export function setupMobileMenu(){
 const panel=document.querySelector('.sidebar'),toggle=document.querySelector('.mobile-menu'),closeButton=document.querySelector('.sidebar-close'),backdrop=document.querySelector('.menu-backdrop'),shell=document.querySelector('.shell'),mobile=matchMedia('(max-width:800px)');
 let start=null;
 function setOpen(open,restore=true){
  open=mobile.matches&&open;
  const hadFocus=panel.contains(document.activeElement);
  panel.style.transform='';panel.classList.remove('dragging');panel.classList.toggle('open',open);
  document.body.classList.toggle('menu-is-open',open);backdrop.hidden=!open;
  toggle.setAttribute('aria-expanded',String(open));shell.inert=open;
  panel.inert=mobile.matches&&!open;
  if(mobile.matches)panel.setAttribute('aria-hidden',String(!open));else panel.removeAttribute('aria-hidden');
  if(open)closeButton.focus();else if(restore&&hadFocus&&mobile.matches)toggle.focus();
 }
 toggle.onclick=()=>setOpen(!panel.classList.contains('open'));
 closeButton.onclick=()=>setOpen(false);backdrop.onclick=()=>setOpen(false);
 panel.addEventListener('click',event=>{if(event.target.closest('a'))setOpen(false);});
 document.addEventListener('keydown',event=>{
  if(!mobile.matches||!panel.classList.contains('open'))return;
  if(event.key==='Escape'){event.preventDefault();setOpen(false);}
  if(event.key==='Tab'){
   const items=[...panel.querySelectorAll('a[href],button:not([disabled])')].filter(el=>el.getClientRects().length),first=items[0],last=items.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
 });
 panel.addEventListener('touchstart',event=>{if(mobile.matches&&panel.classList.contains('open')&&event.touches.length===1)start={x:event.touches[0].clientX,y:event.touches[0].clientY,dx:0,dragging:false};},{passive:true});
 panel.addEventListener('touchmove',event=>{
  if(!start||event.touches.length!==1)return;
  const dx=event.touches[0].clientX-start.x,dy=event.touches[0].clientY-start.y;
  if(!start.dragging&&Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)){start=null;return;}
  if(dx< -10&&Math.abs(dx)>Math.abs(dy)){start.dragging=true;start.dx=dx;panel.classList.add('dragging');panel.style.transform=`translateX(${Math.max(-panel.offsetWidth,dx)}px)`;}
 },{passive:true});
 panel.addEventListener('touchend',()=>{if(!start)return;const close=start.dragging&&start.dx< -60;start=null;if(close)setOpen(false);else{panel.style.transform='';panel.classList.remove('dragging');}},{passive:true});
 panel.addEventListener('touchcancel',()=>{start=null;panel.style.transform='';panel.classList.remove('dragging');},{passive:true});
 mobile.addEventListener('change',()=>setOpen(false,false));setOpen(false,false);
 return ()=>setOpen(false);
}
