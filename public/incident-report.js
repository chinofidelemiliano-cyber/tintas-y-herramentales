import {formatTimestamp,getTimeSettings,effectiveTimeZone} from './time.js';
import {readablePDFStyle,mmToPoints,pdfColor,logoLayout} from './pdf-style.js';
import {jpegPhoto,incidentSeconds,incidentClock} from './incident-photos.js';
import {assemblePDF,wrapPDFText,pdfLiteral} from './pdf-report.js';
export function createIncidentPDF(record,{dateLabel=record.date,language='es',logo=null,pdfStyle={},timeSettings=getTimeSettings()}={}){
 const style=readablePDFStyle(pdfStyle),fontScale=style.fontSize/8;
 const images=[];const logoImage=logo?{...jpegPhoto(logo),name:'ReportLogo'}:null;if(logoImage)images.push(logoImage);const layout=logoLayout(logoImage,595,style),headerShift=layout?Math.max(0,layout.y+layout.height+mmToPoints(style.logoGap)+style.titleSize-35):0,photoShrink=layout?headerShift+10:0;let firstPage=true;
 for(const [key,name] of [['before_photo','Before'],['after_photo','After']])if(record[key])images.push({...jpegPhoto(record[key]),name});
 const W=595,H=842,M=mmToPoints(style.margin),C=W-M*2,en=language==='en',pages=[];let stream='';
 const tr=(es,eng)=>en?eng:es;
 const shifted=y=>y+(firstPage&&y>=510?headerShift-photoShrink:headerShift);
 const actualSize=size=>size===17?style.titleSize:size*fontScale;
 const text=(x,y,value,size=9,bold=false,color=null)=>{y=shifted(y);size=actualSize(size);stream+=`BT /${bold?'F2':'F1'} ${size} Tf ${pdfColor(color||(bold?style.titleColor:style.textColor))} rg 1 0 0 1 ${x} ${H-y} Tm (${pdfLiteral(value)}) Tj ET\n`;};
 const box=(x,y,w,h,fill=false)=>{if(firstPage&&y===259&&h===225)h-=photoShrink;y=shifted(y);if(fill)stream+=`${pdfColor(typeof fill==='string'?fill:style.headerColor)} rg ${x} ${H-y-h} ${w} ${h} re f\n`;stream+=`${pdfColor(style.lineColor)} RG 0.6 w ${x} ${H-y-h} ${w} ${h} re S\n`;};
 const fitted=(x,y,value,width,maxLines=4,size=8,color=null)=>{const lines=wrapPDFText(value,width,actualSize(size),style.fontFamily);let shown=lines.slice(0,maxLines);if(lines.length>maxLines)shown[maxLines-1]=tr('Continúa en el detalle.','Continued in details.');shown.forEach((line,i)=>text(x,y+i*(actualSize(size)+3),line,size,false,color));};
 function heading(title){if(layout)stream+=`q ${layout.width} 0 0 ${layout.height} ${layout.x} ${H-layout.y-layout.height} cm /ReportLogo Do Q\n`;if(style.showTitle)text(M,35,title,17,true);text(M,55,record.folio+' · '+dateLabel,9);}

 heading(tr('REGISTRO DE INCIDENCIAS','INCIDENT REPORT'));
 text(M,75,tr('Registro comparativo de muestras','Sample comparison record')+(record.started_at?' · '+tr('Tiempo: ','Time: ')+incidentClock(incidentSeconds(record)):''),10);
 const labels=[tr('Folio','Reference'),tr('Fecha','Date'),'ODP / NP',tr('Máquina','Machine'),tr('Elaborado por','Prepared by'),tr('Responsable','Owner')];
 const values=[record.folio,dateLabel,record.order_ref+(record.np?' / '+record.np:''),record.machine,record.prepared_by||'',record.responsible];
 const cw=C/6;
 labels.forEach((label,i)=>{box(M+i*cw,104,cw,18,true);box(M+i*cw,122,cw,50);fitted(M+i*cw+4,116,label,cw-8,1,7,style.headerTextColor);fitted(M+i*cw+4,135,values[i],cw-8,3,8);});
 text(M,196,tr('1. Evidencia física de la incidencia','1. Physical evidence'),10,true);
 if(style.showNotes)text(M,212,images.some(i=>i.name!=='ReportLogo')?tr('Fotografías del defecto y de la corrección.','Photos of the defect and correction.'):tr('Pegar las muestras y señalar la zona de la incidencia.','Attach samples and mark the affected area.'),8);
 const half=C/2;
 [tr('ANTES','BEFORE'),tr('DESPUÉS','AFTER')].forEach((label,i)=>{box(M+i*half,224,half,35,true);text(M+i*half+8,238,label,9,true,style.headerTextColor);text(M+i*half+8,252,tr('Muestra '+(i?'después':'antes')+' de la corrección',i?'Sample after correction':'Sample before correction'),8,false,style.headerTextColor);box(M+i*half,259,half,225);});
 for(const [index,name] of ['Before','After'].entries()){
  const image=images.find(i=>i.name===name);if(!image)continue;
  const ratio=Math.min((half-16)/image.width,(209-photoShrink)/image.height),w=image.width*ratio,h=image.height*ratio,x=M+index*half+(half-w)/2,y=267+headerShift+(209-photoShrink-h)/2;
  stream+=`q ${w} 0 0 ${h} ${x} ${H-y-h} cm /${name} Do Q\n`;
 }
 text(M,510,tr('2. Comparación y validación','2. Comparison and validation'),10,true);
 const comparison=[[record.color_observed?tr('Color observado','Observed color'):tr('Incidencia / defecto','Incident / defect'),record.color_observed||record.description],[record.test_result?tr('Resultado de la prueba','Test result'):tr('Acción / corrección','Action / correction'),record.test_result||record.action],[tr('Observaciones','Notes'),record.validation_notes||[record.impact,record.status].filter(Boolean).join(' · ')]];
 comparison.forEach(([label,value],i)=>{const y=522+i*47;box(M,y,165,47,style.striped&&i%2===0?style.stripeColor:false);box(M+165,y,C-165,47,style.striped&&i%2===0?style.stripeColor:false);text(M+6,y+16,label,8,true);fitted(M+171,y+14,value||'',C-177,3);});
 text(M,690,tr('3. Firmas de validación','3. Validation signatures'),10,true);
 [tr('Preprensa','Prepress'),tr('Calidad','Quality'),tr('Encargado de producción','Production manager')].forEach((label,i)=>{const w=C/3;box(M+i*w,703,w,20,true);box(M+i*w,723,w,57);text(M+i*w+6,716,label,8,false,style.headerTextColor);});
 pages.push(stream);stream='';firstPage=false;heading(tr('DETALLE DE LA INCIDENCIA','INCIDENT DETAILS'));
 const fields=[...(record.started_at?[[tr('Inicio','Started'),formatTimestamp(record.started_at,timeSettings)],[tr('Finalización','Ended'),record.ended_at?formatTimestamp(record.ended_at,timeSettings):tr('En curso','Running')],[tr('Tiempo transcurrido','Elapsed time'),incidentClock(incidentSeconds(record))]]:[]),[tr('Zona horaria','Time zone'),effectiveTimeZone(timeSettings)],[tr('Elaborado por','Prepared by'),record.prepared_by||'—'],[tr('Orden de producción / NP','Production order / NP'),record.order_ref+(record.np?' / '+record.np:'')],[tr('Máquina','Machine'),record.machine],[tr('Responsable','Owner'),record.responsible],[tr('Impacto','Impact'),record.impact],[tr('Estatus','Status'),record.status],[tr('Incidencia','Incident'),record.description],[tr('Acción realizada','Action taken'),record.action||tr('Pendiente de capturar.','Pending.')],[tr('Color observado','Observed color'),record.color_observed||'—'],[tr('Resultado de la prueba','Test result'),record.test_result||'—'],[tr('Observaciones de validación','Validation notes'),record.validation_notes||'—']];
 const detailTop=82+headerShift,detailBottom=H-M-24,initialFont=actualSize(9),labelWidth=Math.min(155,C*.3);
 const measured=fields.map(([label,value])=>({label,value,labels:wrapPDFText(label,labelWidth-12,initialFont-.5,style.fontFamily),lines:wrapPDFText(value,C-labelWidth-12,initialFont,style.fontFamily)}));
 const rowHeight=row=>Math.max(row.labels.length,row.lines.length)*(initialFont+2.5)+8;
 const write=(x,top,value,size,bold=false,color=style.textColor)=>{stream+=`BT /${bold?'F2':'F1'} ${size} Tf ${pdfColor(color)} rg 1 0 0 1 ${x} ${H-top} Tm (${pdfLiteral(value)}) Tj ET\n`;};
 const rectangle=(x,top,width,height,fill)=>{if(fill)stream+=`${pdfColor(fill)} rg ${x} ${H-top-height} ${width} ${height} re f\n`;stream+=`${pdfColor(style.lineColor)} RG 0.5 w ${x} ${H-top-height} ${width} ${height} re S\n`;};
 if(measured.reduce((sum,row)=>sum+rowHeight(row),0)<=detailBottom-detailTop){
  let top=detailTop;
  measured.forEach((row,index)=>{const height=rowHeight(row);rectangle(M,top,labelWidth,height,style.headerColor);rectangle(M+labelWidth,top,C-labelWidth,height,style.striped&&index%2===0?style.stripeColor:null);row.labels.forEach((line,j)=>write(M+6,top+initialFont+4+j*(initialFont+2.5),line,initialFont-.5,true,style.headerTextColor));row.lines.forEach((line,j)=>write(M+labelWidth+6,top+initialFont+4+j*(initialFont+2.5),line,initialFont));top+=height;});
 }else{
  // Long descriptions flow across two columns on the detail sheet; nothing is truncated.
  const gap=16,columnWidth=(C-gap)/2;
  function plan(size){
   const output=[];let column=0,top=detailTop;const lineHeight=size+1.1;
   function nextColumn(){column++;top=detailTop;return column<2;}
   function label(text){const lines=wrapPDFText(text,columnWidth,size+.5,style.fontFamily);if(top+lines.length*(lineHeight+.5)+lineHeight+3>detailBottom&&!nextColumn())return false;for(const line of lines){output.push({x:M+column*(columnWidth+gap),y:top+size+.5,text:line,size:size+.5,bold:true});top+=lineHeight+.5;}top+=3;return true;}
   for(const [name,value] of fields){
    if(!label(name))return null;
    for(const line of wrapPDFText(value,columnWidth,size,style.fontFamily)){
     if(top+lineHeight>detailBottom){if(!nextColumn()||!label(name+tr(' (continuación)',' (continued)')))return null;}
     output.push({x:M+column*(columnWidth+gap),y:top+size,text:line,size,bold:false});top+=lineHeight;
    }
    top+=Math.max(3,size*.5);
   }
   return output;
  }
  let layoutPlan=null;
  for(let size=initialFont;size>=4;size-=.25){layoutPlan=plan(size);if(layoutPlan)break;}
  if(!layoutPlan)layoutPlan=plan(4);
  if(!layoutPlan)throw Error(tr('El detalle excede dos páginas incluso con formato compacto. Resume los textos para generar el reporte; no se recortaron datos.','The detail exceeds two pages even in compact format. Shorten the text to generate the report; no data was truncated.'));
  for(const item of layoutPlan)write(item.x,item.y,item.text,item.size,item.bold,item.bold?style.titleColor:style.textColor);
 }

 pages.push(stream);
 return assemblePDF(pages,{width:W,height:H,images,fontFamily:style.fontFamily,footer:style.showPageNumbers?(page,total)=>record.folio+' · '+tr('Página','Page')+' '+page+' '+tr('de','of')+' '+total:null});
}
