// Dependency-free, paginated PDF table writer for browser and Node.
// Built-in Helvetica uses WinAnsi, including Spanish accents.
const extra = new Map([[0x20ac,128],[0x201a,130],[0x0192,131],[0x201e,132],[0x2026,133],[0x2020,134],[0x2021,135],[0x02c6,136],[0x2030,137],[0x0160,138],[0x2039,139],[0x0152,140],[0x017d,142],[0x2018,145],[0x2019,146],[0x201c,147],[0x201d,148],[0x2022,149],[0x2013,150],[0x2014,151],[0x02dc,152],[0x2122,153],[0x0161,154],[0x203a,155],[0x0153,156],[0x017e,158],[0x0178,159]]);
function bytes(text) {
  return Uint8Array.from([...text].map(c => {const n=c.codePointAt(0);return n<=255?n:extra.get(n)||63;}));
}
const literal = text => String(text ?? '').replace(/[\x00-\x1f]/g,' ').replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)');
function width(text, size) {
  // Conservative Helvetica widths keep cell text inside its column.
  let units=0;
  for(const c of text) units += /[ilI.,:;'!| ]/.test(c)?0.29:/[MWmw@%]/.test(c)?0.92:/[A-ZÁÉÍÓÚÑ]/.test(c)?0.73:0.59;
  return units*size;
}
function wrap(value, maxWidth, size) {
  const text=String(value??'').replace(/\s+/g,' ').trim();
  if(!text)return [''];
  const lines=[];let line='';
  for(const word of text.split(' ')) {
    if(line && width(line+' '+word,size)>maxWidth){lines.push(line);line='';}
    if(width(word,size)<=maxWidth){line+=(line?' ':'')+word;continue;}
    for(const c of word){if(line&&width(line+c,size)>maxWidth){lines.push(line);line='';}line+=c;}
  }
  if(line)lines.push(line);
  return lines;
}

export function createTablePDF({title,subtitle='',notes=[],columns,rows,summary='',sections=[],brand='Tintas y herramentales',language='es'}) {
  const reports=[{title,columns,rows,summary},...sections];
  const recordCount=reports.reduce((s,r)=>s+r.rows.length,0);
  if(!columns?.length)throw Error('El reporte necesita columnas.');
  const W=842,H=595,margin=32,bottom=H-42,size=7.3,lineHeight=11;
  let totalWidth=columns.reduce((s,c)=>s+c.width,0);
  if(totalWidth>W-2*margin)throw Error('Las columnas exceden el ancho de la página.');
  const pages=[];let stream='',y=0;
  const text=(x,top,value,fontSize=size,bold=false,color='0.23 0.29 0.26')=>{stream+=`BT /${bold?'F2':'F1'} ${fontSize} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${(H-top).toFixed(2)} Tm (${literal(value)}) Tj ET\n`;};
  const rect=(x,top,w,h,color)=>{stream+=`${color} rg ${x} ${H-top-h} ${w} ${h} re f\n`;};
  let noteLines=notes.flatMap(n=>wrap(n,totalWidth,8));
  function newPage(){
    if(stream)pages.push(stream);
    stream='';text(margin,35,brand,10,true);text(margin,58,title,17,true);
    text(margin,75,subtitle,8,false,'0.48 0.54 0.49');
    y=88;
    for(const n of noteLines){text(margin,y,n,8);y+=11;}
    y+=5;
    const labels=columns.map(c=>wrap(c.label,c.width-12,size));
    const headerHeight=Math.max(...labels.map(l=>l.length))*lineHeight+12;
    rect(margin,y,totalWidth,headerHeight,'0.90 0.94 0.91');
    let x=margin;labels.forEach((lines,i)=>{lines.forEach((l,j)=>text(x+6,y+12+j*lineHeight,l,size,true));x+=columns[i].width;});
    y+=headerHeight;
  }
  for(const report of reports){
  ({title,columns,rows,summary=''}=report);
  if(!columns?.length)throw Error('El reporte necesita columnas.');
  totalWidth=columns.reduce((s,c)=>s+c.width,0);
  if(totalWidth>W-2*margin)throw Error('Las columnas exceden el ancho de la página.');
  noteLines=[...notes,...(report.notes||[])].flatMap(n=>wrap(n,totalWidth,8));
  newPage();
  for(let rowIndex=0;rowIndex<rows.length;rowIndex++) {
    const lines=columns.map((c,i)=>wrap(rows[rowIndex][i],c.width-12,size));
    const maxLines=Math.max(...lines.map(l=>l.length));let offset=0;
    while(offset<maxLines){
      let count=Math.min(maxLines-offset,Math.floor((bottom-y-12)/lineHeight));
      if(count<1){newPage();count=Math.min(maxLines-offset,Math.floor((bottom-y-12)/lineHeight));}
      if(count<1)throw Error('Las notas del reporte no dejan espacio para la tabla.');
      const height=count*lineHeight+12;
      if(rowIndex%2===0)rect(margin,y,totalWidth,height,'0.97 0.98 0.97');
      let x=margin;
      lines.forEach((cell,i)=>{cell.slice(offset,offset+count).forEach((l,j)=>text(x+6,y+12+j*lineHeight,l));x+=columns[i].width;});
      stream+=`0.89 0.92 0.89 RG 0.3 w ${margin} ${H-y-height} m ${margin+totalWidth} ${H-y-height} l S\n`;
      y+=height;offset+=count;
      if(offset<maxLines)newPage();
    }
  }
  if(!rows.length){text(margin+6,y+18,report.emptyMessage||(language==='en'?'No records match the selected filters.':'Sin registros para los filtros seleccionados.'),9);y+=30;}
  if(summary){const lines=wrap(summary,totalWidth,9);if(y+lines.length*13+15>bottom)newPage();y+=18;for(const l of lines){text(margin,y,l,9,true);y+=13;}}
  }
  pages.push(stream);
  return assemblePDF(pages,{width:W,height:H,footer:(page,total)=>`${language==='en'?'Inventory':'Inventario'} · ${recordCount} ${language==='en'?'records':'registros'} · ${language==='en'?'Page':'Página'} ${page} ${language==='en'?'of':'de'} ${total}`});
}

export function assemblePDF(pages,{width:W,height:H,footer,images=[]}){
  const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
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
