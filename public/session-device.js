import {deviceKey} from './device-notifications.js';
export function sessionDeviceInfo(userId){
 const ua=navigator.userAgent||'',browser=/Edg\//.test(ua)?'Microsoft Edge':/OPR\//.test(ua)?'Opera':/Firefox|FxiOS/.test(ua)?'Firefox':/Chrome|CriOS/.test(ua)?'Chrome':/Safari/.test(ua)?'Safari':'Otro navegador';
 const platform=/iPhone/.test(ua)?'iPhone':/iPad/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)?'iPad':/Android/.test(ua)?'Android':/Windows/.test(ua)?'Windows':/Mac/.test(ua)?'Mac':/Linux/.test(ua)?'Linux':'Otro sistema';
 let key;try{if(userId)key=deviceKey(userId);else key=localStorage.getItem('inventory-login-device-key');if(!key){key=crypto.randomUUID();localStorage.setItem('inventory-login-device-key',key);}}catch{key=sessionDeviceInfo.fallbackKey||=crypto.randomUUID();}
 return {device_key:key,device_name:platform+' · '+browser,browser,platform,origin:location.origin};
}
