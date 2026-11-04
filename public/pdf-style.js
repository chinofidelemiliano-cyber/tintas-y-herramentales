export const defaultPDFStyle=Object.freeze({logoWidth:100,logoAlign:'center',logoGap:3,margin:11,fontFamily:'sans',fontSize:8,titleSize:17,rowSpacing:'normal',titleColor:'#24344f',textColor:'#26322d',headerColor:'#e5edf6',headerTextColor:'#24344f',stripeColor:'#f5f8fa',lineColor:'#cbd5dc',striped:true,showTitle:true,showNotes:false,showIssuedDate:false,showSummary:true,showPageNumbers:true});
export function normalizePDFStyle(value={}){
 const number=(key,min,max)=>{const n=Number(value?.[key]);return value?.[key]!==''&&value?.[key]!=null&&Number.isFinite(n)?Math.max(min,Math.min(max,n)):defaultPDFStyle[key];};
 const choose=(key,values)=>values.includes(value?.[key])?value[key]:defaultPDFStyle[key];
 const color=key=>/^#[0-9a-f]{6}$/i.test(value?.[key]||'')?value[key]:defaultPDFStyle[key];
 const boolean=key=>typeof value?.[key]==='boolean'?value[key]:defaultPDFStyle[key];
 return {logoWidth:number('logoWidth',40,180),logoAlign:choose('logoAlign',['left','center','right']),logoGap:number('logoGap',0,10),margin:number('margin',8,18),fontFamily:choose('fontFamily',['sans','serif','mono']),fontSize:number('fontSize',7,11),titleSize:number('titleSize',14,24),rowSpacing:choose('rowSpacing',['compact','normal','relaxed']),...Object.fromEntries(['titleColor','textColor','headerColor','headerTextColor','stripeColor','lineColor'].map(k=>[k,color(k)])),...Object.fromEntries(['striped','showTitle','showNotes','showIssuedDate','showSummary','showPageNumbers'].map(k=>[k,boolean(k)]))};
}
export const mmToPoints=value=>value*72/25.4;
export function pdfColor(hex){return hex.slice(1).match(/../g).map(pair=>(parseInt(pair,16)/255).toFixed(4)).join(' ');}
export function logoLayout(image,pageWidth,style,maxHeight=100){
 if(!image)return null;const margin=mmToPoints(style.margin),scale=Math.min(mmToPoints(style.logoWidth)/image.width,(pageWidth-2*margin)/image.width,maxHeight/image.height),width=image.width*scale,height=image.height*scale;
 return {width,height,x:style.logoAlign==='left'?margin:style.logoAlign==='right'?pageWidth-margin-width:(pageWidth-width)/2,y:margin};
}
