import {readablePDFStyle,mmToPoints,pdfColor,logoLayout} from './pdf-style.js';
import {jpegPhoto} from './incident-photos.js';
// Dependency-free, paginated PDF table writer for browser and Node.
// Built-in Helvetica uses WinAnsi, including Spanish accents.
const extra = new Map([[0x20ac,128],[0x201a,130],[0x0192,131],[0x201e,132],[0x2026,133],[0x2020,134],[0x2021,135],[0x02c6,136],[0x2030,137],[0x0160,138],[0x2039,139],[0x0152,140],[0x017d,142],[0x2018,145],[0x2019,146],[0x201c,147],[0x201d,148],[0x2022,149],[0x2013,150],[0x2014,151],[0x02dc,152],[0x2122,153],[0x0161,154],[0x203a,155],[0x0153,156],[0x017e,158],[0x0178,159]]);
function bytes(text) {
  return Uint8Array.from([...text].map(c => {const n=c.codePointAt(0);return n<=255?n:extra.get(n)||63;}));
}
const literal = text => String(text ?? '').replace(/[\x00-\x1f]/g,' ').replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)');
const fontWidths={
 sans:{upper:[667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611],lower:[556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500],digit:556,space:278},
 serif:{upper:[722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611],lower:[444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444],digit:500,space:250}
};
function width(text,size,fontFamily='sans'){
 if(fontFamily==='mono')return [...text].length*size*.6;
 const metrics=fontWidths[fontFamily]||fontWidths.sans;let units=0;
 for(const character of text){const c=character.normalize('NFD').replace(/[\u0300-\u036f]/g,'');const n=c.charCodeAt(0);
  if(n>=65&&n<=90)units+=metrics.upper[n-65];else if(n>=97&&n<=122)units+=metrics.lower[n-97];else if(/[0-9]/.test(c))units+=metrics.digit;else if(c===' ')units+=metrics.space;else if('.,:;!'.includes(c))units+=metrics.space;else if('()[]-/'.includes(c))units+=333;else if(c==='—')units+=1000;else units+=556;
 }
 return units*size/1000;
}

function wrap(value, maxWidth, size, fontFamily='sans') {
  const text=String(value??'').replace(/\s+/g,' ').trim();
  if(!text)return [''];
  const lines=[];let line='';
  for(const word of text.split(' ')) {
    if(line && width(line+' '+word,size,fontFamily)>maxWidth){lines.push(line);line='';}
    if(width(word,size,fontFamily)<=maxWidth){line+=(line?' ':'')+word;continue;}
    for(const c of word){if(line&&width(line+c,size,fontFamily)>maxWidth){lines.push(line);line='';}line+=c;}
  }
  if(line)lines.push(line);
  return lines;
}

export function createTablePDF({title,subtitle='',notes=[],columns,rows,summary='',sections=[],language='es',logo=null,pdfStyle={}}) {
 const style=readablePDFStyle(pdfStyle),logoImage=logo?{...jpegPhoto(logo),name:'ReportLogo'}:null;
 const W=842,H=595,margin=mmToPoints(style.margin),bottom=H-margin-16,size=style.fontSize,lineHeight=size+3,padding={compact:6,normal:10,relaxed:15}[style.rowSpacing],available=W-2*margin;
 const layout=logoLayout(logoImage,W,style),reports=[{title,columns,rows,summary},...sections];
 const textColor=pdfColor(style.textColor),headerColor=pdfColor(style.headerColor),headerText=pdfColor(style.headerTextColor),titleColor=pdfColor(style.titleColor),lineColor=pdfColor(style.lineColor);
 const pages=[];let stream='',y=0,currentColumns=[],noteLines=[],forceTitle=false;
 const wrapped=(value,width,size)=>wrap(value,width,size,style.fontFamily);
 const text=(x,top,value,fontSize=size,bold=false,color=textColor)=>{stream+=`BT /${bold?'F2':'F1'} ${fontSize} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${(H-top).toFixed(2)} Tm (${literal(value)}) Tj ET\n`;};
 const rect=(x,top,w,h,color)=>{stream+=`${color} rg ${x} ${H-top-h} ${w} ${h} re f\n`;};
 function headerHeight(){return ((style.showTitle||forceTitle)?wrapped(title,available,style.titleSize).length*(style.titleSize+3)+7:0)+(style.showIssuedDate&&subtitle?18:0)+noteLines.length*11+6+Math.max(...currentColumns.map(c=>wrapped(c.label,c.width-12,size).length))*lineHeight+padding;}
 function drawHeader(){
  if(style.showTitle||forceTitle){for(const line of wrapped(title,available,style.titleSize)){text(margin,y+style.titleSize,line,style.titleSize,true,titleColor);y+=style.titleSize+3;}y+=7;}
  if(style.showIssuedDate&&subtitle){text(margin,y+9,subtitle,8);y+=18;}
  for(const n of noteLines){text(margin,y+8,n,8);y+=11;}
  y+=6;
  const labels=currentColumns.map(c=>wrapped(c.label,c.width-12,size)),height=Math.max(...labels.map(l=>l.length))*lineHeight+padding;
  rect(margin,y,available,height,headerColor);let x=margin;
  labels.forEach((lines,i)=>{lines.forEach((line,j)=>text(x+6,y+size+padding/2+j*lineHeight,line,size,true,headerText));x+=currentColumns[i].width;});y+=height;
 }
 function newPage(){if(stream)pages.push(stream);stream='';y=margin;if(layout){stream+=`q ${layout.width} 0 0 ${layout.height} ${layout.x} ${H-layout.y-layout.height} cm /ReportLogo Do Q\n`;y=layout.y+layout.height+mmToPoints(style.logoGap);}drawHeader();}
 for(const report of reports){
  ({title,columns,rows,summary=''}=report);forceTitle=!!report.forceTitle;if(!columns?.length)throw Error('El reporte necesita columnas.');
  const total=columns.reduce((sum,c)=>sum+c.width,0);if(!Number.isFinite(total)||total<=0)throw Error('Anchos de columna no válidos.');currentColumns=columns.map(c=>({...c,width:c.width*available/total}));
  noteLines=style.showNotes?[...notes,...(report.notes||[])].flatMap(n=>wrapped(n,available,8)):[];const firstRowHeight=rows.length?Math.max(...currentColumns.map((c,i)=>wrapped(rows[0][i],c.width-12,size).length))*lineHeight+padding:30;if(report.continuePage&&stream&&y+20+headerHeight()+firstRowHeight<=bottom){y+=20;drawHeader();}else newPage();
  for(let rowIndex=0;rowIndex<rows.length;rowIndex++){
   const lines=currentColumns.map((c,i)=>wrapped(rows[rowIndex][i],c.width-12,size)),maxLines=Math.max(...lines.map(l=>l.length));let offset=0;
   while(offset<maxLines){
    let count=Math.min(maxLines-offset,Math.floor((bottom-y-padding)/lineHeight));
    if(count<1){newPage();count=Math.min(maxLines-offset,Math.floor((bottom-y-padding)/lineHeight));}
    if(count<1)throw Error('El encabezado no deja espacio para la tabla. Reduce el logo o el tamaño del texto.');
    const height=count*lineHeight+padding;if(style.striped&&rowIndex%2===0)rect(margin,y,available,height,pdfColor(style.stripeColor));let x=margin;
    lines.forEach((cell,i)=>{cell.slice(offset,offset+count).forEach((line,j)=>text(x+6,y+size+padding/2+j*lineHeight,line));x+=currentColumns[i].width;});
    stream+=`${lineColor} RG 0.3 w ${margin} ${H-y-height} m ${margin+available} ${H-y-height} l S\n`;y+=height;offset+=count;if(offset<maxLines)newPage();
   }
  }
  if(!rows.length){text(margin+6,y+18,report.emptyMessage||(language==='en'?'No records match the selected filters.':'Sin registros para los filtros seleccionados.'),9);y+=30;}
  if(style.showSummary&&summary){const lines=wrapped(summary,available,9);for(let index=0;index<lines.length;index++){if(y+24>bottom)newPage();y+=index===0?18:13;text(margin,y,lines[index],9,true);}}
 }
 pages.push(stream);
 return assemblePDF(pages,{width:W,height:H,images:logoImage?[logoImage]:[],fontFamily:style.fontFamily,footer:style.showPageNumbers?(page,total)=>`${language==='en'?'Page':'Página'} ${page} ${language==='en'?'of':'de'} ${total}`:null});
}

export function assemblePDF(pages,{width:W,height:H,footer,images=[],fontFamily='sans'}){
  const fonts={sans:['Helvetica','Helvetica-Bold'],serif:['Times-Roman','Times-Bold'],mono:['Courier','Courier-Bold']}[fontFamily]||['Helvetica','Helvetica-Bold'];
  const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>','', `<< /Type /Font /Subtype /Type1 /BaseFont /${fonts[0]} /Encoding /WinAnsiEncoding >>`,`<< /Type /Font /Subtype /Type1 /BaseFont /${fonts[1]} /Encoding /WinAnsiEncoding >>`];
  const imageRefs=[];
  for(const image of images){
    const id=objects.length;imageRefs.push('/'+image.name+' '+id+' 0 R');
    let binary='';for(let offset=0;offset<image.data.length;offset+=8192)binary+=String.fromCharCode(...image.data.subarray(offset,offset+8192));
    objects.push(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /${image.components===1?'DeviceGray':'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.length} >>\nstream\n${binary}\nendstream`);
  }
  const kids=[];
  pages.forEach((content,i)=>{
    const pageId=objects.length,contentId=pageId+1;kids.push(`${pageId} 0 R`);
    if(footer)content+=`BT /F1 8 Tf 0.5 0.57 0.51 rg 1 0 0 1 32 21 Tm (${literal(footer(i+1,pages.length))}) Tj ET\n`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${imageRefs.join(' ')} >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${bytes(content).length} >>\nstream\n${content}endstream`);
  });
  objects[2]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  let output='%PDF-1.4\n%âãÏÓ\n';const offsets=[0];
  for(let i=1;i<objects.length;i++){offsets.push(bytes(output).length);output+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const start=bytes(output).length;
  output+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  output+=offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('');
  output+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return bytes(output);
}

export {wrap as wrapPDFText,literal as pdfLiteral};
