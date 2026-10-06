import JSZip from 'jszip';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { readXcmgSpreadsheet } from './clients/xcmg-spreadsheet';

GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();

export {};

type PdfCandidate={filename:string;bytes:ArrayBuffer};
type PdfTextItem={str?:string;transform?:number[];width?:number;height?:number};
type Box={x:number;y:number;w:number;h:number};

const norm=(value:string)=>value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');
const esc=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]||char));

let pdfCache:Promise<PdfCandidate[]>|null=null;
let sheetCache:ReturnType<typeof readXcmgSpreadsheet>|null=null;

function resetCaches(){pdfCache=null;sheetCache=null}
document.addEventListener('change',event=>{if(event.target instanceof HTMLInputElement&&event.target.matches('[data-xcmg-file]'))resetCaches()});

async function pdfCandidates():Promise<PdfCandidate[]>{
  if(pdfCache)return pdfCache;
  pdfCache=(async()=>{
    const out:PdfCandidate[]=[];
    const nf=document.querySelector<HTMLInputElement>('[data-xcmg-file="nf"]')?.files?.[0];
    if(nf)out.push({filename:nf.name,bytes:await nf.arrayBuffer()});
    const zipFile=document.querySelector<HTMLInputElement>('[data-xcmg-file="zip"]')?.files?.[0];
    if(zipFile){
      const zip=await JSZip.loadAsync(await zipFile.arrayBuffer());
      const entries=Object.values(zip.files).filter(entry=>!entry.dir&&/\.pdf$/i.test(entry.name));
      for(const entry of entries)out.push({filename:entry.name,bytes:await entry.async('arraybuffer')});
    }
    return out;
  })();
  return pdfCache;
}

async function spreadsheet(){
  if(sheetCache)return sheetCache;
  const file=document.querySelector<HTMLInputElement>('[data-xcmg-file="sheet"]')?.files?.[0];
  if(!file)throw new Error('A planilha da XCMG não está mais selecionada.');
  sheetCache=readXcmgSpreadsheet(file);
  return sheetCache;
}

function rowData(row:HTMLElement){
  return{
    label:row.querySelector<HTMLElement>('.client-report-field b')?.textContent?.trim()||'',
    value:row.querySelector<HTMLElement>('.client-report-value')?.textContent?.trim()||'',
    source:row.querySelector<HTMLElement>('.client-report-source-detail > span')?.textContent?.trim()||row.querySelector<HTMLElement>('.client-report-field span')?.textContent?.trim()||''
  };
}

function parsePdfSource(source:string){
  const m=source.match(/^NF\s*·\s*(.*?)\s*·\s*página\s*(\d+)\s*·\s*(.*)$/i);
  return m?{filename:m[1].trim(),page:Number(m[2]),note:m[3].trim()}:null;
}
function parseExcelSource(source:string){
  const m=source.match(/^Excel\s*·\s*(.*?)\s*·\s*aba\s*(.*?)\s*·\s*([^·]+?)\s*·\s*(.*)$/i);
  return m?{filename:m[1].trim(),sheet:m[2].trim(),cells:m[3].trim(),note:m[4].trim()}:null;
}
function sameFile(a:string,b:string){const aa=a.replace(/\\/g,'/').toLowerCase(),bb=b.replace(/\\/g,'/').toLowerCase();return aa===bb||aa.split('/').pop()===bb.split('/').pop()}

function ensureLightbox(){
  let modal=document.querySelector<HTMLElement>('.client-report-preview-modal');if(modal)return modal;
  modal=document.createElement('div');modal.className='client-report-preview-modal';modal.hidden=true;
  modal.innerHTML='<button type="button" class="client-report-preview-modal-close" aria-label="Fechar visualização">×</button><div class="client-report-preview-modal-body"><img alt="Visualização ampliada da fonte"></div>';
  document.body.appendChild(modal);const close=()=>{if(modal)modal.hidden=true};
  modal.addEventListener('click',event=>{if(event.target===modal)close()});modal.querySelector('.client-report-preview-modal-close')?.addEventListener('click',close);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&modal&&!modal.hidden)close()});return modal;
}
function openPreview(src:string,alt:string){const modal=ensureLightbox(),img=modal.querySelector<HTMLImageElement>('img');if(!img)return;img.src=src;img.alt=alt;modal.hidden=false}

function itemBox(item:PdfTextItem,viewport:any,scale:number):Box{
  const t=item.transform||[];const [x,y]=viewport.convertToViewportPoint(Number(t[4]||0),Number(t[5]||0));
  return{x,y:y-Math.max(12,Number(item.height||9)*scale),w:Math.max(18,Number(item.width||0)*scale),h:Math.max(12,Number(item.height||9)*scale)};
}
function drawBox(ctx:CanvasRenderingContext2D,canvas:HTMLCanvasElement,box:Box){
  const pad=7,x=Math.max(0,box.x-pad),y=Math.max(0,box.y-pad),w=Math.min(canvas.width-x,box.w+pad*2),h=Math.min(canvas.height-y,box.h+pad*2);
  ctx.save();ctx.strokeStyle='#c8102e';ctx.lineWidth=4;ctx.fillStyle='rgba(200,16,46,.14)';ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);ctx.restore();
}

function anchorsFor(label:string){
  if(/^Cliente$/i.test(label))return['XCMG BRASIL','CNPJ'];
  if(/Remetente|Exportador/i.test(label))return['DESTINATARIOREMETENTE','NOMERAZAOSOCIAL'];
  if(/Local de Armazenagem/i.test(label))return['RECINTOALFANDEGADO'];
  if(/Ref\. do Cliente/i.test(label))return['REFCLIENTE'];
  if(/Nº Documento/i.test(label))return['NUMERODADECLARACAO'];
  if(/Destinatário|Importador/i.test(label))return['XCMG BRASIL','CNPJ'];
  if(/CNPJ do Cliente/i.test(label))return['CNPJ'];
  if(/Peso Líquido/i.test(label))return['PESOLIQUIDO'];
  if(/Valor Total da Nota/i.test(label))return['VALORTOTALDANOTA'];
  return[];
}

function matchingItems(items:PdfTextItem[],value:string,label:string){
  const nv=norm(value),anchors=anchorsFor(label),usable=items.filter(item=>String(item.str||'').trim()&&item.transform);
  let matches=usable.filter(item=>{const t=norm(String(item.str||''));return nv&&t&&(t===nv||t.includes(nv)||nv.includes(t))});
  if(matches.length)return matches.slice(0,4);
  const tokens=value.split(/\s+/).map(norm).filter(t=>t.length>=4);
  matches=usable.filter(item=>{const t=norm(String(item.str||''));return tokens.some(token=>t.includes(token)||token.includes(t))});
  if(matches.length)return matches.slice(0,4);
  return usable.filter(item=>{const t=norm(String(item.str||''));return anchors.some(a=>t.includes(a)||a.includes(t))}).slice(0,2);
}

async function renderPdf(row:HTMLElement,parsed:NonNullable<ReturnType<typeof parsePdfSource>>,container:HTMLElement){
  const all=await pdfCandidates();const candidate=all.find(item=>sameFile(item.filename,parsed.filename));if(!candidate)throw new Error('O PDF usado como fonte não está mais disponível nesta análise.');
  const pdf=await getDocument({data:new Uint8Array(candidate.bytes.slice(0))}).promise;if(parsed.page<1||parsed.page>pdf.numPages)throw new Error('Página da fonte não localizada.');
  const page=await pdf.getPage(parsed.page),scale=1.6,viewport=page.getViewport({scale}),canvas=document.createElement('canvas');
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Não foi possível gerar o print.');
  await page.render({canvas,canvasContext:ctx,viewport}).promise;
  const content=await page.getTextContent(),items=content.items as PdfTextItem[],{label,value}=rowData(row);const boxes=matchingItems(items,value,label).map(item=>itemBox(item,viewport,scale));boxes.forEach(box=>drawBox(ctx,canvas,box));
  let output=canvas;
  if(boxes.length){
    const minX=Math.min(...boxes.map(b=>b.x)),minY=Math.min(...boxes.map(b=>b.y)),maxX=Math.max(...boxes.map(b=>b.x+b.w)),maxY=Math.max(...boxes.map(b=>b.y+b.h));
    const px=220,py=115,sx=Math.max(0,Math.floor(minX-px)),sy=Math.max(0,Math.floor(minY-py)),sw=Math.min(canvas.width-sx,Math.ceil(maxX-minX+px*2)),sh=Math.min(canvas.height-sy,Math.ceil(maxY-minY+py*2));
    const crop=document.createElement('canvas');crop.width=Math.max(1,sw);crop.height=Math.max(1,sh);crop.getContext('2d')?.drawImage(canvas,sx,sy,sw,sh,0,0,sw,sh);output=crop;
  }
  const wrap=document.createElement('div');wrap.className='client-report-source-preview-card';const caption=document.createElement('div');caption.className='client-report-source-preview-caption';caption.textContent=`Print da NF · ${parsed.filename} · página ${parsed.page} · ${parsed.note} · clique para ampliar`;
  const img=document.createElement('img');img.className='client-report-source-preview-image';img.src=output.toDataURL('image/png');img.alt=`Print da fonte ${label} na NF`;img.tabIndex=0;img.setAttribute('role','button');img.addEventListener('click',()=>openPreview(img.src,img.alt));img.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openPreview(img.src,img.alt)}});wrap.append(caption,img);container.appendChild(wrap);
}

function parseCell(ref:string){const m=ref.trim().match(/^([A-Z]+)(\d+)$/i);if(!m)return null;let col=0;for(const ch of m[1].toUpperCase())col=col*26+(ch.charCodeAt(0)-64);return{row:Number(m[2])-1,col:col-1}}
function colName(index:number){let n=index+1,out='';while(n){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26)}return out}

async function renderExcel(parsed:NonNullable<ReturnType<typeof parseExcelSource>>,container:HTMLElement){
  const snap=await spreadsheet();const sh=snap.sheets.find(sheet=>sheet.name===parsed.sheet);if(!sh)throw new Error(`A aba ${parsed.sheet} não foi localizada na planilha.`);
  const refs=parsed.cells.split(',').map(value=>parseCell(value)).filter(Boolean) as Array<{row:number;col:number}>;if(!refs.length)throw new Error('As células de origem não puderam ser identificadas.');
  const minRow=Math.max(0,Math.min(...refs.map(r=>r.row))-3),maxRow=Math.min(sh.rows.length-1,Math.max(...refs.map(r=>r.row))+5),minCol=Math.max(0,Math.min(...refs.map(r=>r.col))-2),maxCol=Math.max(...refs.map(r=>r.col))+3;
  const cellW=170,rowH=34,headH=34,rowLabelW=48,width=rowLabelW+(maxCol-minCol+1)*cellW,height=headH+(maxRow-minRow+1)*rowH,canvas=document.createElement('canvas');canvas.width=Math.min(width,1600);canvas.height=Math.min(height,900);const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Não foi possível gerar o print da planilha.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.font='13px Arial';ctx.textBaseline='middle';
  for(let c=minCol;c<=maxCol;c++){const x=rowLabelW+(c-minCol)*cellW;ctx.fillStyle='#f2f2f2';ctx.fillRect(x,0,cellW,headH);ctx.strokeStyle='#cfcfcf';ctx.strokeRect(x,0,cellW,headH);ctx.fillStyle='#444';ctx.fillText(colName(c),x+8,headH/2)}
  for(let r=minRow;r<=maxRow;r++){
    const y=headH+(r-minRow)*rowH;ctx.fillStyle='#f2f2f2';ctx.fillRect(0,y,rowLabelW,rowH);ctx.strokeStyle='#cfcfcf';ctx.strokeRect(0,y,rowLabelW,rowH);ctx.fillStyle='#555';ctx.fillText(String(r+1),8,y+rowH/2);
    for(let c=minCol;c<=maxCol;c++){
      const x=rowLabelW+(c-minCol)*cellW,isHit=refs.some(ref=>ref.row===r&&ref.col===c);ctx.fillStyle=isHit?'rgba(200,16,46,.14)':'#fff';ctx.fillRect(x,y,cellW,rowH);ctx.strokeStyle=isHit?'#c8102e':'#d9d9d9';ctx.lineWidth=isHit?3:1;ctx.strokeRect(x,y,cellW,rowH);ctx.fillStyle='#222';ctx.font='12px Arial';const text=String(sh.rows[r]?.[c]||'');ctx.save();ctx.beginPath();ctx.rect(x+4,y+2,cellW-8,rowH-4);ctx.clip();ctx.fillText(text,x+7,y+rowH/2);ctx.restore();
    }
  }
  const wrap=document.createElement('div');wrap.className='client-report-source-preview-card';const caption=document.createElement('div');caption.className='client-report-source-preview-caption';caption.textContent=`Print da planilha · ${parsed.filename} · aba ${parsed.sheet} · ${parsed.cells} · ${parsed.note} · clique para ampliar`;
  const img=document.createElement('img');img.className='client-report-source-preview-image';img.src=canvas.toDataURL('image/png');img.alt=`Print da planilha ${parsed.sheet}`;img.tabIndex=0;img.setAttribute('role','button');img.addEventListener('click',()=>openPreview(img.src,img.alt));img.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openPreview(img.src,img.alt)}});wrap.append(caption,img);container.appendChild(wrap);
}

async function buildPreview(row:HTMLElement,source:string,container:HTMLElement){
  if(container.dataset.loading==='true'||container.dataset.loaded==='true')return;container.dataset.loading='true';container.innerHTML='<div class="client-report-preview-loading">Gerando print da fonte...</div>';
  try{
    container.replaceChildren();const pdf=parsePdfSource(source),excel=parseExcelSource(source);
    if(pdf)await renderPdf(row,pdf,container);
    else if(excel)await renderExcel(excel,container);
    else container.innerHTML='<div class="client-report-preview-unavailable">Esta informação vem de uma regra exclusiva da XCMG; não existe um trecho de arquivo para imprimir.</div>';
    container.dataset.loaded='true';
  }catch(error){container.innerHTML=`<div class="client-report-preview-unavailable">${esc(error instanceof Error?error.message:'Não foi possível gerar o print da fonte.')}</div>`;container.dataset.loaded='true'}finally{delete container.dataset.loading}
}

function enhance(root:ParentNode=document){
  root.querySelectorAll<HTMLElement>('.xcmg-report-view .client-report-row').forEach((row,index)=>{
    if(row.dataset.xcmgSourceEnhanced==='true')return;
    const field=row.querySelector<HTMLElement>('.client-report-field'),confidence=row.querySelector<HTMLElement>('.client-report-confidence');if(!field||!confidence)return;
    let detail=row.querySelector<HTMLElement>('.client-report-source-detail'),toggle=row.querySelector<HTMLButtonElement>('.client-report-source-toggle');
    let sourceText=detail?.querySelector<HTMLElement>(':scope > span')?.textContent?.trim()||field.querySelector<HTMLElement>('span')?.textContent?.trim()||'Fonte não informada.';
    if(!detail||!toggle){
      field.querySelector<HTMLElement>('span')?.remove();const status=document.createElement('span');status.className='client-report-confidence-text';while(confidence.firstChild)status.appendChild(confidence.firstChild);
      toggle=document.createElement('button');toggle.type='button';toggle.className='client-report-source-toggle';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Mostrar fonte desta informação');toggle.innerHTML='<span aria-hidden="true">⌄</span>';
      detail=document.createElement('div');detail.className='client-report-source-detail';detail.id=`xcmg-report-source-${Date.now()}-${index}`;detail.hidden=true;detail.innerHTML=`<b>Fonte da informação</b><span>${esc(sourceText)}</span><div class="client-report-source-preview"></div>`;toggle.setAttribute('aria-controls',detail.id);confidence.append(status,toggle);row.appendChild(detail);row.dataset.sourceEnhanced='true';
    }
    const preview=detail.querySelector<HTMLElement>('.client-report-source-preview');if(!preview)return;
    toggle.onclick=event=>{event.preventDefault();event.stopPropagation();const open=toggle!.getAttribute('aria-expanded')==='true';toggle!.setAttribute('aria-expanded',String(!open));toggle!.setAttribute('aria-label',open?'Mostrar fonte desta informação':'Ocultar fonte desta informação');detail!.hidden=open;row.classList.toggle('source-open',!open);if(!open)void buildPreview(row,sourceText,preview)};
    row.dataset.xcmgSourceEnhanced='true';
  });
}

const observer=new MutationObserver(mutations=>{for(const mutation of mutations)for(const node of mutation.addedNodes){if(node instanceof Element&&(node.matches('.xcmg-report-view')||node.querySelector('.xcmg-report-view')||node.matches('.client-report-row')))enhance(node.matches('.client-report-row')?node.parentNode||document:node)}});
const start=()=>{enhance();observer.observe(document.documentElement,{childList:true,subtree:true})};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
