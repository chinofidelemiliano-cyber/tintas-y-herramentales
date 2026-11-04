export const maxPhotoLength=450000;
export function jpegPhoto(dataURL){
 if(typeof dataURL!=='string'||dataURL.length>maxPhotoLength||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(dataURL))throw Error('La foto debe ser JPEG y pesar menos de 330 KB después de prepararla.');
 let data;try{data=Uint8Array.from(atob(dataURL.split(',')[1]),c=>c.charCodeAt(0));}catch{throw Error('La foto no es válida.');}
 if(data[0]!==255||data[1]!==216)throw Error('La foto no contiene un JPEG válido.');
 let offset=2;
 while(offset+8<data.length){
  if(data[offset]!==255){offset++;continue;}
  const marker=data[offset+1];offset+=2;
  if(marker===0xd9||marker===0xda)break;
  if(marker===0x00||marker===0xff||marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
  const size=(data[offset]<<8)|data[offset+1];if(size<2||offset+size>data.length)break;
  if([0xc0,0xc1,0xc2].includes(marker)){
   const height=(data[offset+3]<<8)|data[offset+4],width=(data[offset+5]<<8)|data[offset+6],components=data[offset+7];
   if(width<1||height<1||width>1600||height>1600||![1,3].includes(components))throw Error('Dimensiones de foto no válidas.');
   return {data,width,height,components};
  }
  offset+=size;
 }
 throw Error('No se pudo leer la foto JPEG.');
}
export async function prepareIncidentPhoto(file){
 if(!file||!file.type.startsWith('image/'))throw Error('Selecciona una imagen.');
 if(file.size>15*1024*1024)throw Error('Selecciona una imagen de hasta 15 MB.');
 let bitmap;try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{throw Error('No se pudo abrir la imagen. Usa una foto JPG o PNG.');}
 try{
  if(bitmap.width*bitmap.height>40000000)throw Error('La foto es demasiado grande. Usa una imagen de menor resolución.');
  let limit=1200;
  for(let attempt=0;attempt<5;attempt++){
   const scale=Math.min(1,limit/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
   const value=canvas.toDataURL('image/jpeg',Math.max(.5,.78-attempt*.06));if(value.length<=maxPhotoLength){jpegPhoto(value);return value;}limit=Math.round(limit*.8);
  }
  throw Error('No se pudo reducir la foto. Prueba con una imagen más pequeña.');
 }finally{bitmap.close();}
}
export function incidentSeconds(record,now=Date.now()){
 if(!record?.started_at)return 0;
 const end=record.ended_at?Date.parse(record.ended_at):now,start=Date.parse(record.started_at);
 if(!Number.isFinite(end)||!Number.isFinite(start))return 0;
 return Math.max(0,Math.floor((end-start)/1000));
}
export function incidentClock(seconds){return [Math.floor(seconds/3600),Math.floor(seconds%3600/60),Math.floor(seconds%60)].map(n=>String(n).padStart(2,'0')).join(':');}
