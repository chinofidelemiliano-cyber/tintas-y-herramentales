export function preparationMinutes(start, end, nextDay=false){
 const seconds=value=>{
  const match=/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value||'');
  if(!match)throw Error('Captura horas válidas de inicio y fin.');
  return Number(match[1])*3600+Number(match[2])*60+Number(match[3]||0);
 };
 const elapsed=seconds(end)-seconds(start)+(nextDay?86400:0);
 if(elapsed<0)throw Error('La hora de fin es anterior al inicio. Marca «Termina al día siguiente» si corresponde.');
 if(elapsed>86400)throw Error('La preparación no puede superar 24 horas. Revisa las horas y el cambio de día.');
 return Math.round(elapsed/60*100)/100;
}
