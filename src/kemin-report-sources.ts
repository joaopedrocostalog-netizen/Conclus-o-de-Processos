import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { createWorker } from 'tesseract.js';

GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();
export {};

type PdfCandidate={filename:string;bytes:ArrayBuffer};
type PdfTextItem={str?:string;transform?:number[];width?:number;height?:number};
type Box={x:number;y:number;w:number;h:number};
type TextLine={items:PdfTextItem[];text:string;normalized:string;y:number};
type SourcePart={filename:string;page:number;value:string};

const norm=(v:string)=>v.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');
const txt=(item:PdfTextItem)=>String(item.str||'').trim();
const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
const parseNumber=(value:string)=>{const cleaned=value.replace(/[^\d.,-]/g,'');if(!cleaned)return null;const n=Number(cleaned.replace(/\./g,'').replace(',','.'));return Number.isFinite(n)?n:null};
const sameNumber=(a:string,b:string)=>{const aa=parseNumber(a),bb=parseNumber(b);return aa!==null&&bb!==null&&Math.abs(aa-bb)<0.00001};

let cache:Promise<PdfCandidate[]>|null=null;
let ocrWorkerPromise:Promise<any>|null=null;
function getOcrWorker(){return ocrWorkerPromise||(ocrWorkerPromise=createWorker('eng'))}
document.addEventListener('change',e=>{if(e.target instanceof HTMLInputElement&&e.target.matches('[data-kemin-file="pdfs"]'))cache=null});

async function candidates(){
  if(cache)return cache;
  cache=(async()=>{const out:PdfCandidate[]=[];for(const file of Array.from(document.querySelector<HTMLInputElement>('[data-kemin-file="pdfs"]')?.files||[]))out.push({filename:file.name,bytes:await file.arrayBuffer()});return out})();
  return cache;
}
function sameFile(a:string,b:string){const aa=a.replace(/\\/g,'/').toLowerCase(),bb=b.replace(/\\/g,'/').toLowerCase();return aa===bb||aa.split('/').pop()===bb.split('/').pop()}
function parsePdfSource(source:string){const m=source.match(/^PDF\s*·\s*(.*?)\s*·\s*página\s*(\d+)\s*·\s*(.*)$/i);return m?{filename:m[1].trim(),page:Number(m[2]),note:m[3].trim()}:null}
function parseAggregate(source:string){
  if(!/^Soma de\s+\d+\s+.+?\s*·/i.test(source))return null;
  const body=source.replace(/^Soma de\s+\d+\s+.+?\s*·\s*/i,''),parts:SourcePart[]=[];
  const re=/(?:^|\s\+\s)(.*?)\s*·\s*página\s*(\d+)\s*·\s*(?:R\$\s*)?([\d.]+,\d{2,6})(?=\s\+\s|$)/gi;
  for(const m of body.matchAll(re))parts.push({filename:m[1].trim(),page:Number(m[2]),value:m[3].trim()});
  return parts.length?parts:null;
}
function parseMultiPdfSource(source:string){
  if(!/^PDFs\s*·/i.test(source))return null;
  const body=source.replace(/^PDFs\s*·\s*/i,'').replace(/\s*·\s*contêineres identificados\s*$/i,''),parts:SourcePart[]=[];
  const re=/(?:^|\s\+\s)(.*?)\s*·\s*página\s*(\d+)\s*·\s*([A-Z]{4}\d{7})(?=\s\+\s|$)/gi;
  for(const m of body.matchAll(re))parts.push({filename:m[1].trim(),page:Number(m[2]),value:m[3].trim()});
  return parts.length?parts:null;
}
function rowData(row:HTMLElement){return{label:row.querySelector<HTMLElement>('.client-report-field b')?.textContent?.trim()||'',value:row.querySelector<HTMLElement>('.client-report-value')?.textContent?.trim()||'',source:row.querySelector<HTMLElement>('.client-report-source-detail > span')?.textContent?.trim()||row.querySelector<HTMLElement>('.client-report-field span')?.textContent?.trim()||''}}
function itemBox(item:PdfTextItem,viewport:any,scale:number):Box{const t=item.transform||[],p=viewport.convertToViewportPoint(Number(t[4]||0),Number(t[5]||0)),h=Math.max(12,Number(item.height||9)*scale);return{x:p[0],y:p[1]-h,w:Math.max(18,Number(item.width||0)*scale),h}}
function merge(boxes:Box[]):Box|null{if(!boxes.length)return null;const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y)),r=Math.max(...boxes.map(b=>b.x+b.w)),bottom=Math.max(...boxes.map(b=>b.y+b.h));return{x,y,w:r-x,h:bottom-y}}
function draw(ctx:CanvasRenderingContext2D,b:Box){const p=7;ctx.save();ctx.strokeStyle='#c8102e';ctx.lineWidth=4;ctx.fillStyle='rgba(200,16,46,.12)';ctx.fillRect(b.x-p,b.y-p,b.w+p*2,b.h+p*2);ctx.strokeRect(b.x-p,b.y-p,b.w+p*2,b.h+p*2);ctx.restore()}
function lines(items:PdfTextItem[]):TextLine[]{
  const usable=items.filter(i=>txt(i)&&i.transform).map(i=>({item:i,y:Number(i.transform?.[5]||0),x:Number(i.transform?.[4]||0)})),groups:Array<{y:number;cells:typeof usable}>=[];
  for(const cell of usable){let g=groups.find(x=>Math.abs(x.y-cell.y)<=2.8);if(!g){g={y:cell.y,cells:[]};groups.push(g)}g.cells.push(cell)}
  return groups.sort((a,b)=>b.y-a.y).map(g=>{const cells=g.cells.sort((a,b)=>a.x-b.x),text=cells.map(c=>txt(c.item)).join(' ').replace(/\s+/g,' ').trim();return{items:cells.map(c=>c.item),text,normalized:norm(text),y:g.y}}).filter(l=>l.text)
}
function anchorsFor(label:string,note:string){
  if(/Peso Líquido/i.test(label))return['PESO LIQUIDO','PESO LÍQUIDO'];
  if(/Valor Total da Nota/i.test(label))return['VALOR TOTAL DA NOTA'];
  if(/Ref\. do Cliente/i.test(label))return['IMP:','REF CLIENTE','INFORMACOES COMPLEMENTARES'];
  if(/Nº Documento/i.test(label))return['EXTRATO DA DUIMP'];
  if(/Nº BL|AWB/i.test(label))return['BILL OF LADING NO','BILL OF LADING NUMBER','B/L NO','HBL'];
  if(/Contêineres/i.test(label))return['CONTAINERS','CONTAINER','MARKS & NUMBERS'];
  if(/CNPJ/i.test(label))return['CNPJ'];
  if(/Remetente|Exportador/i.test(label))return['NOME/RAZAO SOCIAL','DESTINATARIO/REMETENTE','SHIPPER'];
  if(/Destinatário|Importador/i.test(label)||/^Cliente$/i.test(label))return['NOME DO IMPORTADOR','IDENTIFICACAO DO EMITENTE'];
  if(/Local de Armazenagem/i.test(label))return['UNIDADE DE ENTRADA/DESCARGA','RECINTO'];
  if(/Agência Marítima/i.test(label))return['VESSEL / VOYAGE'];
  if(/Tipo Documento/i.test(label))return['EXTRATO DA DUIMP','DUIMP'];
  if(/Operação Marítima/i.test(label))return['DUIMP','IMPORTACAO'];
  return note?[note]:[];
}
function valueLines(ls:TextLine[],value:string,label:string){
  const nv=norm(value);
  return ls.filter(line=>{
    if(nv&&line.normalized.includes(nv))return true;
    if(/Peso Líquido|Valor Total da Nota/i.test(label)){
      const nums=[...line.text.matchAll(/[\d.]+,\d{2,6}/g)].map(m=>m[0]);
      return nums.some(candidate=>sameNumber(candidate,value));
    }
    return false;
  });
}
function matchedItems(line:TextLine,value:string,label:string){
  if(/Peso Líquido|Valor Total da Nota/i.test(label)){
    const candidates=line.items.filter(item=>sameNumber(txt(item),value));if(candidates.length)return candidates;
  }
  if(/Nº BL|AWB|Contêineres/i.test(label)){
    const exactToken=line.items.filter(item=>norm(txt(item))===norm(value)||norm(txt(item)).includes(norm(value)));
    if(exactToken.length)return exactToken;
  }
  const nv=norm(value),tokens=value.split(/\s+/).map(norm).filter(t=>t.length>=2);
  const exact=line.items.filter(item=>{const ni=norm(txt(item));return ni&&(nv===ni||nv.includes(ni)||ni.includes(nv))});
  if(exact.length)return exact;
  const tokenItems=line.items.filter(item=>{const ni=norm(txt(item));return tokens.some(t=>ni===t||(t.length>=3&&ni.includes(t)))});
  return tokenItems.length?tokenItems:line.items;
}
function select(items:PdfTextItem[],value:string,label:string,note:string){
  const ls=lines(items),anchors=anchorsFor(label,note).map(norm),anchorIndexes=ls.map((line,index)=>anchors.some(a=>a&&line.normalized.includes(a))?index:-1).filter(i=>i>=0),values=valueLines(ls,value,label);
  let target:TextLine|undefined;

  if(/Nº BL|AWB/i.test(label)){
    const anchor=anchorIndexes[0];
    if(anchor!==undefined){
      const nearby=ls.slice(anchor,Math.min(ls.length,anchor+3));
      target=nearby.find(line=>norm(line.text).includes(norm(value)))||values.find(line=>Math.abs(ls.indexOf(line)-anchor)<=2);
    }
  }else if(/Agência Marítima/i.test(label)){
    const anchor=anchorIndexes[0];
    if(anchor!==undefined){
      const nearby=ls.slice(anchor,Math.min(ls.length,anchor+3));
      target=nearby.find(line=>norm(line.text).includes(norm(value)))||values.find(line=>Math.abs(ls.indexOf(line)-anchor)<=2);
    }
  }else if(/Contêineres/i.test(label)){
    const preferred=anchorIndexes.find(index=>ls[index].normalized.includes('CONTAINERS'));
    if(preferred!==undefined){
      const nearby=ls.slice(preferred,Math.min(ls.length,preferred+3));
      target=nearby.find(line=>norm(line.text).includes(norm(value)))||values.find(line=>Math.abs(ls.indexOf(line)-preferred)<=2);
    }
  }

  if(!target){
    if(values.length&&anchorIndexes.length){
      target=values.map(line=>({line,index:ls.indexOf(line),score:Math.min(...anchorIndexes.map(a=>Math.abs(ls.indexOf(line)-a)))})).sort((a,b)=>a.score-b.score)[0]?.line;
    }else target=values[0];
  }
  const context:TextLine[]=[];
  for(const index of anchorIndexes.slice(0,2))context.push(ls[index]);
  if(target&&!context.includes(target))context.push(target);
  return{target,targetItems:target?matchedItems(target,value,label):[],context};
}
function crop(canvas:HTMLCanvasElement,boxes:Box[]){if(!boxes.length)return canvas;const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y)),r=Math.max(...boxes.map(b=>b.x+b.w)),bottom=Math.max(...boxes.map(b=>b.y+b.h)),px=80,py=50,sx=Math.max(0,Math.floor(x-px)),sy=Math.max(0,Math.floor(y-py)),sw=Math.min(canvas.width-sx,Math.ceil(r-x+px*2)),sh=Math.min(canvas.height-sy,Math.ceil(bottom-y+py*2));const out=document.createElement('canvas');out.width=Math.max(1,sw);out.height=Math.max(1,sh);out.getContext('2d')?.drawImage(canvas,sx,sy,sw,sh,0,0,sw,sh);return out}
function ensureLightbox(){let modal=document.querySelector<HTMLElement>('.client-report-preview-modal');if(modal)return modal;modal=document.createElement('div');modal.className='client-report-preview-modal';modal.hidden=true;modal.innerHTML='<button type="button" class="client-report-preview-modal-close" aria-label="Fechar visualização">×</button><div class="client-report-preview-modal-body"><img alt="Visualização ampliada da fonte"></div>';document.body.appendChild(modal);const close=()=>{if(modal)modal.hidden=true};modal.addEventListener('click',e=>{if(e.target===modal)close()});modal.querySelector('.client-report-preview-modal-close')?.addEventListener('click',close);return modal}
function openPreview(src:string,alt:string){const modal=ensureLightbox(),img=modal.querySelector<HTMLImageElement>('img');if(img){img.src=src;img.alt=alt;modal.hidden=false}}

type OcrVisualLine={text:string;box:Box};
function collectOcrVisualLines(node:any,out:OcrVisualLine[]){
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node.lines)){
    for(const line of node.lines){
      const text=String(line?.text||'').trim(),b=line?.bbox;
      if(text&&b&&Number.isFinite(b.x0)&&Number.isFinite(b.y0)&&Number.isFinite(b.x1)&&Number.isFinite(b.y1)){
        out.push({text,box:{x:b.x0,y:b.y0,w:b.x1-b.x0,h:b.y1-b.y0}});
      }
    }
  }
  for(const key of ['blocks','paragraphs'])if(Array.isArray(node[key]))for(const child of node[key])collectOcrVisualLines(child,out);
}
function overlapX(a:Box,b:Box){return Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))}
function visualAnchors(lines:OcrVisualLine[],label:string,note:string){
  const anchors=anchorsFor(label,note).map(norm);
  return lines.filter(line=>anchors.some(a=>a&&norm(line.text).includes(a)));
}
function visualValueMatches(lines:OcrVisualLine[],value:string,label:string){
  const nv=norm(value);
  return lines.filter(line=>{
    const nt=norm(line.text);
    if(nv&&(nt.includes(nv)||nv.includes(nt)))return true;
    if(/Peso Líquido|Valor Total da Nota/i.test(label))return [...line.text.matchAll(/[\d.]+,\d{2,6}/g)].some(m=>sameNumber(m[0],value));
    return false;
  });
}
function nearestBelow(anchor:OcrVisualLine,lines:OcrVisualLine[],maxGap=150){
  return lines.filter(line=>line.box.y>=anchor.box.y&&line.box.y-(anchor.box.y+anchor.box.h)<=maxGap&&overlapX(anchor.box,line.box)>0)
    .sort((a,b)=>(a.box.y-(anchor.box.y+anchor.box.h))-(b.box.y-(anchor.box.y+anchor.box.h))||Math.abs(a.box.x-anchor.box.x)-Math.abs(b.box.x-anchor.box.x));
}
async function directedVesselBox(canvas:HTMLCanvasElement,value:string):Promise<{target:Box|null;context:Box[]}>{
  try{
    const sx=0,sy=Math.floor(canvas.height*0.22),sw=Math.floor(canvas.width*0.62),sh=Math.floor(canvas.height*0.42);
    const cropCanvas=document.createElement('canvas');cropCanvas.width=Math.max(1,sw);cropCanvas.height=Math.max(1,sh);
    cropCanvas.getContext('2d')?.drawImage(canvas,sx,sy,sw,sh,0,0,sw,sh);
    const worker=await getOcrWorker();try{await worker.setParameters({tessedit_pageseg_mode:'6' as any})}catch{};const result=await worker.recognize(cropCanvas,{}, {text:true,blocks:true}),visual:OcrVisualLine[]=[];
    collectOcrVisualLines(result?.data,visual);
    const anchors=visual.filter(line=>/VESSELVOYAGE/.test(norm(line.text)));
    const values=visual.filter(line=>norm(line.text).includes(norm(value)));
    let target:OcrVisualLine|undefined=values[0];
    if(!target&&anchors.length){
      const anchor=anchors[0];
      target=nearestBelow(anchor,visual,150).find(line=>!/PLACE\s+OF|PORT\s+OF|BILL\s+OF\s+LADING|ORIGINAL/i.test(line.text));
    }
    const shift=(box:Box):Box=>({x:box.x+sx,y:box.y+sy,w:box.w,h:box.h});
    if(target)return{target:shift(target.box),context:[...anchors.slice(0,1).map(a=>shift(a.box)),shift(target.box)]};
    return{target:null,context:anchors.slice(0,1).map(a=>shift(a.box))};
  }catch{return{target:null,context:[]}}
}

async function ocrBox(canvas:HTMLCanvasElement,value:string,label:string,note:string):Promise<{target:Box|null;context:Box[]}>{
  try{
    const worker=await getOcrWorker(),result=await worker.recognize(canvas,{}, {text:true,blocks:true}),visual:OcrVisualLine[]=[];
    collectOcrVisualLines(result?.data,visual);
    const anchors=visualAnchors(visual,label,note),values=visualValueMatches(visual,value,label);

    if(/Nº BL|AWB/i.test(label)&&anchors.length){
      const anchor=anchors.find(line=>/BILLOFLADING(?:NO|NUMBER)/.test(norm(line.text)))||anchors[0];
      const below=nearestBelow(anchor,visual,120).filter(line=>/\d/.test(line.text)&&!/PLACE|PORT|VESSEL|VOYAGE|BILL|LADING|ORIGINAL/i.test(line.text));
      const target=below.find(line=>norm(line.text).includes(norm(value)))||values.find(line=>overlapX(anchor.box,line.box)>0&&/\d/.test(line.text));
      if(target)return{target:target.box,context:[anchor.box,target.box]};
    }

    if(/Agência Marítima/i.test(label)&&anchors.length){
      const anchor=anchors.find(line=>/VESSELVOYAGE/.test(norm(line.text)))||anchors[0];
      const below=nearestBelow(anchor,visual,150).filter(line=>!/PLACE\s+OF|PORT\s+OF|BILL\s+OF\s+LADING|ORIGINAL/i.test(line.text));
      const target=below.find(line=>norm(line.text).includes(norm(value)))||values.find(line=>overlapX(anchor.box,line.box)>0);
      if(target)return{target:target.box,context:[anchor.box,target.box]};
    }

    if(/Contêineres/i.test(label)&&anchors.length){
      const anchor=anchors.find(line=>/CONTAINERS/.test(norm(line.text)))||anchors[0];
      const target=visual.find(line=>norm(line.text).includes(norm(value)))||nearestBelow(anchor,visual,100).find(line=>/[A-Z]{4}\d{7}/i.test(line.text));
      if(target)return{target:target.box,context:[anchor.box,target.box]};
    }

    if(values.length){
      let target=values[0];
      if(anchors.length){
        target=values.map(line=>({line,score:Math.min(...anchors.map(anchor=>Math.abs(line.box.y-anchor.box.y)+Math.abs(line.box.x-anchor.box.x)))})).sort((a,b)=>a.score-b.score)[0].line;
      }
      return{target:target.box,context:[...anchors.slice(0,2).map(a=>a.box),target.box]};
    }

    if(/Agência Marítima/i.test(label)){
      const directed=await directedVesselBox(canvas,value);
      if(directed.target||directed.context.length)return directed;
    }

    return{target:null,context:anchors.slice(0,2).map(a=>a.box)};
  }catch{return{target:null,context:[]}}
}

function exactNoteTotalSelection(items:PdfTextItem[],value:string,viewport:any,scale:number){
  const phrase='VALORTOTALDANOTA';
  const ls=lines(items);
  const anchorLine=ls.find(line=>line.normalized.includes(phrase));
  if(!anchorLine)return null;

  // Prefer the exact PDF text block for the label instead of merging the whole tax row.
  let anchorItems=anchorLine.items.filter(item=>norm(txt(item)).includes(phrase));
  if(!anchorItems.length){
    const phraseTokens=new Set(['VALOR','TOTAL','DA','NOTA']);
    anchorItems=anchorLine.items.filter(item=>phraseTokens.has(norm(txt(item))));
  }
  const anchorBox=merge((anchorItems.length?anchorItems:anchorLine.items).map(item=>itemBox(item,viewport,scale)));
  if(!anchorBox)return null;

  const candidates=items
    .filter(item=>txt(item)&&item.transform&&sameNumber(txt(item),value))
    .map(item=>({item,box:itemBox(item,viewport,scale)}));
  if(!candidates.length)return null;

  const anchorCenterX=anchorBox.x+anchorBox.w/2;
  const strict=candidates.filter(candidate=>{
    const centerX=candidate.box.x+candidate.box.w/2;
    const verticalGap=candidate.box.y-(anchorBox.y+anchorBox.h);
    const sameColumn=centerX>=anchorBox.x-35&&centerX<=anchorBox.x+anchorBox.w+35;
    return verticalGap>=-10&&verticalGap<=85&&sameColumn;
  });

  const pool=strict.length?strict:candidates;
  const ranked=pool.map(candidate=>{
    const centerX=candidate.box.x+candidate.box.w/2;
    const verticalGap=Math.abs(candidate.box.y-(anchorBox.y+anchorBox.h));
    const horizontalGap=Math.abs(centerX-anchorCenterX);
    return{...candidate,score:verticalGap*6+horizontalGap};
  }).sort((a,b)=>a.score-b.score);

  return{target:ranked[0].box,context:[anchorBox,ranked[0].box]};
}

async function renderPdf(row:HTMLElement,parsed:{filename:string;page:number;note:string},container:HTMLElement,override?:{label:string;value:string}){
  const candidate=(await candidates()).find(c=>sameFile(c.filename,parsed.filename));if(!candidate)throw new Error('O PDF usado como fonte não está mais selecionado.');
  const pdf=await getDocument({data:new Uint8Array(candidate.bytes.slice(0))}).promise;if(parsed.page<1||parsed.page>pdf.numPages)throw new Error('Página da fonte não localizada.');
  const page=await pdf.getPage(parsed.page),scale=1.9,viewport=page.getViewport({scale}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Não foi possível gerar o print.');
  await page.render({canvas,canvasContext:ctx,viewport}).promise;
  const content=await page.getTextContent(),items=content.items as PdfTextItem[],base=rowData(row),label=override?.label||base.label,value=override?.value||base.value,selection=select(items,value,label,parsed.note);
  const exactNote=/Valor Total da Nota/i.test(label)?exactNoteTotalSelection(items,value,viewport,scale):null;
  let target=exactNote?.target||(selection.targetItems.length?merge(selection.targetItems.map(i=>itemBox(i,viewport,scale))):null);
  let contextBoxes=exactNote?.context||selection.context.flatMap(l=>l.items.map(i=>itemBox(i,viewport,scale)));
  if(!target){
    const ocr=await ocrBox(canvas,value,label,parsed.note);target=ocr.target;if(ocr.context.length)contextBoxes=ocr.context;
  }
  if(target)draw(ctx,target);
  const boxes=[...(target?[target]:[]),...contextBoxes],output=crop(canvas,boxes);
  const wrap=document.createElement('div');wrap.className='client-report-source-preview-card';const cap=document.createElement('div');cap.className='client-report-source-preview-caption';cap.textContent=`Print do PDF · ${parsed.filename} · página ${parsed.page} · ${parsed.note} · clique para ampliar`;const img=document.createElement('img');img.className='client-report-source-preview-image';img.src=output.toDataURL('image/png');img.alt=`Fonte de ${label}`;img.tabIndex=0;img.setAttribute('role','button');img.addEventListener('click',()=>openPreview(img.src,img.alt));wrap.append(cap,img);if(!target){const note=document.createElement('div');note.className='client-report-preview-marker-note';note.textContent='A fonte foi identificada, mas não foi possível isolar visualmente o valor para o retângulo.';wrap.append(note)}container.appendChild(wrap)
}

async function renderAggregate(row:HTMLElement,parts:SourcePart[],container:HTMLElement){
  const {label,value:total}=rowData(row),summary=document.createElement('div');summary.className='client-report-source-preview-card';const cap=document.createElement('div');cap.className='client-report-source-preview-caption';cap.textContent=label==='Peso Líquido'?'Cálculo do Peso Líquido total':'Cálculo do Valor Total das Notas';const calc=document.createElement('div');calc.style.padding='12px 14px';calc.style.fontWeight='800';calc.style.fontSize='13px';calc.style.lineHeight='1.5';calc.textContent=`${parts.map(p=>label==='Valor Total da Nota'?`R$ ${p.value}`:p.value).join(' + ')} = ${label==='Valor Total da Nota'?'R$ ':''}${total}`;summary.append(cap,calc);container.appendChild(summary);
  for(const part of parts)await renderPdf(row,{filename:part.filename,page:part.page,note:label==='Peso Líquido'?'Peso Líquido (kg)':'VALOR TOTAL DA NOTA'},container,{label,value:part.value});
}
async function renderMulti(row:HTMLElement,parts:SourcePart[],container:HTMLElement){
  const {label}=rowData(row);
  for(const part of parts)await renderPdf(row,{filename:part.filename,page:part.page,note:'contêiner identificado no documento'},container,{label,value:part.value});
}

async function build(row:HTMLElement,source:string,container:HTMLElement){
  if(container.dataset.loading==='true'||container.dataset.loaded==='true')return;container.dataset.loading='true';container.innerHTML='<div class="client-report-preview-loading">Gerando prints das fontes...</div>';
  try{
    container.replaceChildren();
    const aggregate=parseAggregate(source),multi=parseMultiPdfSource(source),pdf=parsePdfSource(source);
    if(aggregate)await renderAggregate(row,aggregate,container);
    else if(multi)await renderMulti(row,multi,container);
    else if(pdf)await renderPdf(row,pdf,container);
    else container.innerHTML='<div class="client-report-preview-unavailable">Não existe uma fonte PDF localizada para este campo.</div>';
    container.dataset.loaded='true'
  }catch(error){container.innerHTML=`<div class="client-report-preview-unavailable">${esc(error instanceof Error?error.message:'Não foi possível gerar o print da fonte.')}</div>`;container.dataset.loaded='true'}finally{delete container.dataset.loading}
}

function enhance(){
  document.querySelectorAll<HTMLElement>('.kemin-report-view .client-report-row').forEach((row,index)=>{
    if(row.dataset.keminSourceEnhanced==='true')return;const field=row.querySelector<HTMLElement>('.client-report-field'),confidence=row.querySelector<HTMLElement>('.client-report-confidence');if(!field||!confidence)return;
    const source=field.querySelector<HTMLElement>('span')?.textContent?.trim()||'Fonte não informada.';field.querySelector('span')?.remove();const old=(confidence.textContent||'').trim();confidence.replaceChildren();const status=document.createElement('span');status.className='client-report-confidence-text';status.textContent=old;const toggle=document.createElement('button');toggle.type='button';toggle.className='client-report-source-toggle';toggle.setAttribute('aria-expanded','false');toggle.innerHTML='<span aria-hidden="true">⌄</span>';const detail=document.createElement('div');detail.className='client-report-source-detail';detail.id=`kemin-report-source-${Date.now()}-${index}`;detail.hidden=true;detail.innerHTML=`<b>Fonte da informação</b><span>${esc(source)}</span><div class="client-report-source-preview"></div>`;toggle.setAttribute('aria-controls',detail.id);confidence.append(status,toggle);row.appendChild(detail);const preview=detail.querySelector<HTMLElement>('.client-report-source-preview')!;toggle.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const open=toggle.getAttribute('aria-expanded')==='true';toggle.setAttribute('aria-expanded',String(!open));detail.hidden=open;row.classList.toggle('source-open',!open);if(!open)void build(row,source,preview)});row.dataset.keminSourceEnhanced='true';
  })
}
const observer=new MutationObserver(()=>enhance());const start=()=>{enhance();observer.observe(document.documentElement,{childList:true,subtree:true})};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
