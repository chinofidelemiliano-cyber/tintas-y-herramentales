const localKey=userId=>'inventory-notification-device:'+userId;
export function notificationSupport(){
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 if(ios&&!matchMedia('(display-mode: standalone)').matches&&!navigator.standalone)return {supported:false,message:'En iPhone o iPad, usa Compartir → Agregar a pantalla de inicio. Abre el inventario desde ese icono para activar los avisos.'};
 if(!isSecureContext||!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))return {supported:false,message:'Este navegador no admite avisos push aquí. Abre la dirección HTTPS del sitio en un navegador actualizado.'};
 return {supported:true,message:Notification.permission==='denied'?'Las notificaciones están bloqueadas. Permítelas en la configuración de este sitio en tu navegador.':'Activa los avisos en cada equipo que quieras usar.'};
}
export function deviceKey(userId){const key=localKey(userId);let value=localStorage.getItem(key);if(!value){value=crypto.randomUUID();localStorage.setItem(key,value);}return value;}
function publicKeyBytes(value){const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
async function settingsMessage(registration,deviceKey,enabled,type='PUSH_SETTINGS'){const worker=registration.active||registration.waiting;if(!worker)throw Error('El servicio de avisos aún no está listo. Intenta de nuevo.');return new Promise((resolve,reject)=>{const channel=new MessageChannel(),timeout=setTimeout(()=>{channel.port1.close();reject(Error('No se pudo guardar la configuración del dispositivo.'));},5000);channel.port1.onmessage=event=>{clearTimeout(timeout);channel.port1.close();event.data?.ok?resolve(event.data):reject(Error('No se pudo guardar el permiso del dispositivo.'));};worker.postMessage({type,deviceKey,enabled},[channel.port2]);});}
export async function enableDevice(cloud,label){
 const support=notificationSupport();if(!support.supported)throw Error(support.message);
 if(!label.trim()||label.trim().length>80)throw Error('Escribe un nombre de hasta 80 caracteres.');
 // This call occurs directly in the checkbox user gesture (important on Safari).
 const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();if(permission!=='granted')throw Error('No se concedió permiso para mostrar notificaciones.');
 const config=await cloud.pushConfiguration();if(!config?.public_key)throw Error('Falta activar el servicio de envío en Supabase.');
 const key=deviceKey(cloud.userId());await navigator.serviceWorker.register('/notifications-sw.js',{scope:'/',updateViaCache:'none'});const registration=await navigator.serviceWorker.ready;
 let subscription=await registration.pushManager.getSubscription(),created=false;
 if(subscription){const savedDevices=await cloud.devices({operation:'list'}),current=savedDevices.devices.find(d=>d.device_key===key&&d.origin===location.origin);const actual=subscription.options?.applicationServerKey,wanted=publicKeyBytes(config.public_key),mismatch=actual&&(new Uint8Array(actual).length!==wanted.length||new Uint8Array(actual).some((value,i)=>value!==wanted[i]));if(!current||!current.enabled||mismatch||['PUSH_HTTP_410','PUSH_HTTP_404'].includes(current.last_error)){await subscription.unsubscribe();subscription=null;}}
 if(!subscription){subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicKeyBytes(config.public_key)});created=true;}
 let saved;
 try{saved=await cloud.devices({operation:'register',device_key:key,label:label.trim(),origin:location.origin,subscription:subscription.toJSON()});await settingsMessage(registration,key,true);}
 catch(error){if(saved)await cloud.devices({operation:'disable',id:saved.id}).catch(()=>{});if(created)await subscription.unsubscribe().catch(()=>{});throw error;}
 return saved;
}
export async function disableDevice(cloud,device,remove=false){
 const current=device.device_key===deviceKey(cloud.userId())&&device.origin===location.origin;
 if(current&&'serviceWorker'in navigator){const registration=await navigator.serviceWorker.getRegistration('/');if(registration){await settingsMessage(registration,device.device_key,false);const subscription=await registration.pushManager.getSubscription();if(subscription)await subscription.unsubscribe().catch(()=>false);}}
 return cloud.devices({operation:remove?'remove':'disable',id:device.id});
}
export async function stopDeviceOnLogout(cloud){
 if(!('serviceWorker'in navigator))return;const registration=await navigator.serviceWorker.getRegistration('/');if(!registration)return;
 const key=deviceKey(cloud.userId());await settingsMessage(registration,key,false);
 const subscription=await registration.pushManager.getSubscription();if(subscription)await subscription.unsubscribe().catch(()=>false);
 try{const result=await cloud.devices({operation:'list'}),device=result.devices.find(d=>d.device_key===key&&d.origin===location.origin);if(device)await cloud.devices({operation:'disable',id:device.id});}catch{}
}
export function defaultDeviceName(){const ua=navigator.userAgent;return /iPhone/.test(ua)?'Mi iPhone':/iPad/.test(ua)?'Mi iPad':/Android/.test(ua)?'Mi Android':/Windows/.test(ua)?'Mi computadora Windows':/Mac/.test(ua)?'Mi Mac':'Mi dispositivo';}

export async function syncDeviceAccount(cloud){if(!('serviceWorker'in navigator))return;const registration=await navigator.serviceWorker.getRegistration('/');if(registration)return settingsMessage(registration,deviceKey(cloud.userId()),false,'PUSH_ACCOUNT');return {enabled:false};}
