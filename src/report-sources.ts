import JSZip from 'jszip';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const esc=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]||char));
const norm=(value:string)=>value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');
const normalizeContainer=(value:string)=>value.replace(/[^A-Z0-9]/gi,'').toUpperCase();

type SourceInfo={kind:string;filename:string;page:number};
type Candidate={kind:string;filename:string;bytes:ArrayBuffer};
type PdfTextItem={str?:string;transform?:number[];width?:number;height?:number};
type LocatedSource={candidate:Candidate;page:number};
type Box={x:number;y:number;w:number;h:number;cx:number;cy:number};

const sourceInfo=(sourceText:string):SourceInfo|null=>{
  const match=sourceText.match(/^(DOC COMPLETO|NF FISCAL|ZIP PDF)\s*·\s*(.*?)\s*·\s*página\s*(\d+)/i);
  return match?{kind:match[1].toUpperCase(),filename:match[2].trim(),page:Number(match[3])}:null;
};

let candidatesPromise:Promise<Candidate[]>|null=null;
async function getCandidates():Promise<Candidate[]>{
  if(candidatesPromise)return candidatesPromise;
  candidatesPromise=(async()=>{
    const out:Candidate[]=[];
    const doc=document.querySelector<HTMLInputElement>('[data-client-file="doc"]')?.files?.[0];
    const nf=document.querySelector<HTMLInputElement>('[data-client-file="nf"]')?.files?.[0];
    const zipFile=document.querySelector<HTMLInputElement>('[data-client-file="zip"]')?.files?.[0];
    if(doc)out.push({kind:'DOC COMPLETO',filename:doc.name,bytes:await doc.arrayBuffer()});
    if(nf)out.push({kind:'NF FISCAL',filename:nf.name,bytes:await nf.arrayBuffer()});
    if(zipFile){
      const zip=await JSZip.loadAsync(zipFile);
      const entries=Object.values(zip.files).filter(item=>!item.dir&&/\.pdf$/i.test(item.name));
      out.push(...await Promise.all(entries.map(async entry=>({kind:'ZIP PDF',filename:entry.name,bytes:await entry.async('arraybuffer')}))));
    }
    return out;
  })();
  return candidatesPromise;
}
function resetCandidateCache(){candidatesPromise=null}
document.addEventListener('change',event=>{if(event.target instanceof HTMLInputElement&&event.target.type==='file')resetCandidateCache()});

async function sourcePdfBytes(sourceText:string):Promise<ArrayBuffer|null>{
  const info=sourceInfo(sourceText);if(!info)return null;
  const candidates=await getCandidates();
  const wanted=info.filename.replace(/\\/g,'/').toLowerCase();const base=wanted.split('/').pop()||wanted;
  return candidates.find(item=>{
    if(item.kind!==info.kind)return false;
    const name=item.filename.replace(/\\/g,'/').toLowerCase();
    return name===wanted||name.endsWith('/'+base)||name.split('/').pop()===base;
  })?.bytes||null;
}

const rowInfo=(row:HTMLElement)=>({
  label:row.querySelector<HTMLElement>('.client-report-field b')?.textContent?.trim()||'',
  value:row.querySelector<HTMLElement>('.client-report-value')?.textContent?.trim()||''
});

const sourceClue=(sourceText:string)=>{
  const page=sourceText.match(/página\s*\d+\s*:\s*(.*)$/i)?.[1]?.trim()||'';
  return page.replace(/\s*·.*$/,'').trim();
};

const fieldSearchTerms=(row:HTMLElement,sourceText='')=>{
  const {label,value}=rowInfo(row);const terms:string[]=[];
  if(/^Cliente$/i.test(label))terms.push('TRANSPORTADOR / VOLUMES TRANSPORTADOS','RAZÃO SOCIAL',value);
  else if(/CNPJ do Cliente/i.test(label))terms.push('TRANSPORTADOR / VOLUMES TRANSPORTADOS','CNPJ / CPF',value);
  else if(/Valor Total da Nota/i.test(label))terms.push('VALOR TOTAL DA NOTA',value,value.replace(/^R\$\s*/i,''));
  else if(/Nº\s*BL|AWB/i.test(label))terms.push(value,'B/L No','Bill of Lading');
  else if(/Cont[eê]ineres/i.test(label)){
    const containers=value.match(/[A-Z]{4}[-\s]?\d{7}/gi)||[];
    terms.push(...containers.map(normalizeContainer));
  }else if(/Tipo Documento/i.test(label)){
    if(/DUIMP/i.test(value))terms.push('DUIMP');if(/DUE/i.test(value))terms.push('DUE');
    if(/NF-?e/i.test(value))terms.push('DANFE','NF-e');if(/\bBL\b/i.test(value))terms.push('B/L No','Bill of Lading');
  }else if(value)terms.push(value);
  const clue=sourceClue(sourceText);if(clue&&clue.length>3)terms.push(clue);
  return{label,value,terms:[...new Set(terms.map(v=>v?.trim()).filter(Boolean) as string[])]};
};

const filenameScore=(candidate:Candidate,label:string,value:string)=>{
  const name=norm(candidate.filename),nv=norm(value);let score=0;
  if((/^Cliente$/i.test(label)||/CNPJ do Cliente/i.test(label)||/Valor Total da Nota/i.test(label))&&/NFE|NF-E|DANFE|NOTA/i.test(candidate.filename))score+=120;
  if(/Nº\s*BL|AWB/i.test(label)&&nv&&name.includes(nv))score+=130;
  if(/Nº\s*BL|AWB/i.test(label)&&/BL|LADING/i.test(candidate.filename))score+=90;
  if(/Tipo Documento/i.test(label)){
    if(/DUIMP/i.test(value)&&/DUIMP/i.test(candidate.filename))score+=80;
    if(/NF-?e/i.test(value)&&/NFE|DANFE/i.test(candidate.filename))score+=70;
    if(/\bBL\b/i.test(value)&&/BL|LADING/i.test(candidate.filename))score+=60;
  }
  if(/Cont[eê]ineres/i.test(label)&&/DUIMP|NFE|NF-E|BL/i.test(candidate.filename))score+=45;
  return score;
};

async function pageText(pdf:any,pageNumber:number){
  const page=await pdf.getPage(pageNumber);const content=await page.getTextContent();
  return(content.items as PdfTextItem[]).map(item=>String(item?.str||'')).join(' ');
}

async function locateFallbackSource(row:HTMLElement,sourceText=''):Promise<LocatedSource|null>{
  const {label,value,terms}=fieldSearchTerms(row,sourceText);const candidates=await getCandidates();if(!candidates.length)return null;
  const ordered=[...candidates].sort((a,b)=>filenameScore(b,label,value)-filenameScore(a,label,value));
  for(const candidate of ordered){
    const score=filenameScore(candidate,label,value);
    try{
      const pdf=await getDocument({data:new Uint8Array(candidate.bytes.slice(0))}).promise;
      for(let n=1;n<=pdf.numPages;n++){
        const normalized=norm(await pageText(pdf,n));
        if((/^Cliente$/i.test(label)||/CNPJ do Cliente/i.test(label))&&score>=120&&normalized.includes('TRANSPORTADORVOLUMESTRANSPORTADOS'))return{candidate,page:n};
        if(/Valor Total da Nota/i.test(label)&&score>=120&&normalized.includes('VALORTOTALDANOTA'))return{candidate,page:n};
        if(terms.some(term=>{const t=norm(term);return t.length>=3&&normalized.includes(t)}))return{candidate,page:n};
      }
    }catch{}
    if(score>=120)return{candidate,page:1};
  }
  return null;
}

async function locateContainerSources(row:HTMLElement):Promise<Array<LocatedSource&{containers:string[]}>>{
  const {value}=rowInfo(row);const wanted=[...new Set((value.match(/[A-Z]{4}[-\s]?\d{7}/gi)||[]).map(normalizeContainer))];
  if(!wanted.length)return[];
  const candidates=[...(await getCandidates())].sort((a,b)=>filenameScore(b,'Contêineres',value)-filenameScore(a,'Contêineres',value));
  const found=new Map<string,LocatedSource&{containers:string[]}>();const located=new Set<string>();
  for(const candidate of candidates){
    try{
      const pdf=await getDocument({data:new Uint8Array(candidate.bytes.slice(0))}).promise;
      for(let n=1;n<=pdf.numPages;n++){
        const text=norm(await pageText(pdf,n));const hits=wanted.filter(c=>!located.has(c)&&text.includes(c));
        if(!hits.length)continue;
        const key=`${candidate.filename}::${n}`;const prior=found.get(key);
        if(prior)prior.containers.push(...hits);else found.set(key,{candidate,page:n,containers:[...hits]});
        hits.forEach(c=>located.add(c));if(located.size===wanted.length)return[...found.values()];
      }
    }catch{}
  }
  return[...found.values()];
}

function ensureLightbox(){
  let modal=document.querySelector<HTMLElement>('.client-report-preview-modal');if(modal)return modal;
  modal=document.createElement('div');modal.className='client-report-preview-modal';modal.hidden=true;
  modal.innerHTML='<button type="button" class="client-report-preview-modal-close" aria-label="Fechar visualização">×</button><div class="client-report-preview-modal-body"><img alt="Visualização ampliada da fonte"></div>';
  document.body.appendChild(modal);const close=()=>{if(modal)modal.hidden=true};
  modal.addEventListener('click',event=>{if(event.target===modal)close()});modal.querySelector('.client-report-preview-modal-close')?.addEventListener('click',close);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&modal&&!modal.hidden)close()});return modal;
}
function openPreviewModal(src:string,alt:string){const modal=ensureLightbox();const img=modal.querySelector<HTMLImageElement>('img');if(!img)return;img.src=src;img.alt=alt;modal.hidden=false}

function itemBox(item:PdfTextItem,viewport:any,scale:number):Box{
  const t=item.transform||[];const [vx,vy]=viewport.convertToViewportPoint(Number(t[4]||0),Number(t[5]||0));
  const w=Math.max(18,Number(item.width||0)*scale),h=Math.max(12,Number(item.height||9)*scale);return{x:vx,y:vy-h,w,h,cx:vx+w/2,cy:vy-h/2};
}
function drawBox(ctx:CanvasRenderingContext2D,canvas:HTMLCanvasElement,box:Box,pad=7){
  const x=Math.max(0,box.x-pad),y=Math.max(0,box.y-pad),w=Math.min(canvas.width-x,box.w+pad*2),h=Math.min(canvas.height-y,box.h+pad*2);
  ctx.save();ctx.strokeStyle='#c8102e';ctx.lineWidth=4;ctx.fillStyle='rgba(200,16,46,.13)';ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);ctx.restore();
}

function nearestToAnchor(items:PdfTextItem[],viewport:any,scale:number,anchorTerms:string[],value:string){
  const usable=items.filter(item=>String(item.str||'').trim()&&item.transform);const nv=norm(value);
  const anchors=usable.filter(item=>anchorTerms.some(a=>norm(String(item.str||'')).includes(a)));
  const matches=usable.filter(item=>{const t=norm(String(item.str||''));return t&&nv&&(t===nv||(t.length>=6&&nv.length>=6&&(t.includes(nv)||nv.includes(t))))});
  if(!anchors.length)return matches[0]||null;
  const score=(candidate:PdfTextItem)=>{
    const b=itemBox(candidate,viewport,scale);let best=Infinity;
    for(const a of anchors){const ab=itemBox(a,viewport,scale);best=Math.min(best,Math.abs(b.cy-ab.cy)*2+Math.abs(b.cx-ab.cx)+(Math.abs(b.cy-ab.cy)>105?600:0))}
    return best;
  };
  if(matches.length)return[...matches].sort((a,b)=>score(a)-score(b))[0];
  return usable.filter(item=>{
    const t=norm(String(item.str||''));if(t.length<4||anchorTerms.some(a=>t.includes(a)))return false;
    return anchors.some(anchor=>{const a=itemBox(anchor,viewport,scale),b=itemBox(item,viewport,scale);return Math.abs(b.cy-a.cy)<80&&Math.abs(b.cx-a.cx)<300});
  }).sort((a,b)=>score(a)-score(b))[0]||null;
}

function findValueItems(items:PdfTextItem[],value:string,extraTerms:string[]=[]){
  const needles=[value,...extraTerms].map(norm).filter(v=>v.length>=4);
  return items.filter(raw=>{
    const text=norm(String(raw?.str||''));if(text.length<3)return false;
    return needles.some(needle=>text===needle||(text.length>=5&&needle.length>=5&&(text.includes(needle)||needle.includes(text))));
  });
}

async function renderPreviewCard(row:HTMLElement,bytes:ArrayBuffer,info:SourceInfo,sourceText:string,container:HTMLElement,highlightContainers:string[]=[]){
  const pdf=await getDocument({data:new Uint8Array(bytes.slice(0))}).promise;if(info.page<1||info.page>pdf.numPages)throw new Error('Página da fonte não localizada no PDF.');
  const page=await pdf.getPage(info.page),scale=1.35,viewport=page.getViewport({scale});const canvas=document.createElement('canvas');
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Não foi possível criar a prévia.');
  await page.render({canvas,canvasContext:ctx,viewport}).promise;

  const {label,value,terms}=fieldSearchTerms(row,sourceText);let boxes:Box[]=[];
  try{
    const content=await page.getTextContent();const items=content.items as PdfTextItem[];
    if(/^Cliente$/i.test(label)){
      const target=nearestToAnchor(items,viewport,scale,['RAZAOSOCIAL'],value);if(target)boxes=[itemBox(target,viewport,scale)];
    }else if(/CNPJ do Cliente/i.test(label)){
      const target=nearestToAnchor(items,viewport,scale,['CNPJCPF'],value);if(target)boxes=[itemBox(target,viewport,scale)];
    }else if(/Valor Total da Nota/i.test(label)){
      const cleanValue=value.replace(/^R\$\s*/i,'');
      const target=nearestToAnchor(items,viewport,scale,['VALORTOTALDANOTA'],cleanValue)||nearestToAnchor(items,viewport,scale,['VALORTOTALDANOTA'],value);
      if(target)boxes=[itemBox(target,viewport,scale)];
      else{
        const anchor=items.find(item=>norm(String(item.str||'')).includes('VALORTOTALDANOTA'));if(anchor)boxes=[itemBox(anchor,viewport,scale)];
      }
    }else if(/Cont[eê]ineres/i.test(label)){
      const wanted=highlightContainers.length?highlightContainers:(value.match(/[A-Z]{4}[-\s]?\d{7}/gi)||[]).map(normalizeContainer);
      for(const c of wanted){
        const matches=findValueItems(items,c);if(matches[0])boxes.push(itemBox(matches[0],viewport,scale));
      }
    }else{
      const matches=findValueItems(items,value,terms);if(matches[0])boxes=[itemBox(matches[0],viewport,scale)];
      if(!boxes.length){
        const clue=sourceClue(sourceText);const clueMatches=findValueItems(items,clue,terms);if(clueMatches[0])boxes=[itemBox(clueMatches[0],viewport,scale)];
      }
    }
    boxes.forEach(box=>drawBox(ctx,canvas,box));
  }catch{}

  let imageCanvas=canvas;
  if(boxes.length&&(/^Cliente$/i.test(label)||/CNPJ do Cliente/i.test(label)||/Valor Total da Nota/i.test(label))){
    const minX=Math.min(...boxes.map(b=>b.x)),minY=Math.min(...boxes.map(b=>b.y)),maxX=Math.max(...boxes.map(b=>b.x+b.w)),maxY=Math.max(...boxes.map(b=>b.y+b.h));
    const padX=190,padY=100,sx=Math.max(0,Math.floor(minX-padX)),sy=Math.max(0,Math.floor(minY-padY)),sw=Math.min(canvas.width-sx,Math.ceil(maxX-minX+padX*2)),sh=Math.min(canvas.height-sy,Math.ceil(maxY-minY+padY*2));
    const crop=document.createElement('canvas');crop.width=Math.max(1,sw);crop.height=Math.max(1,sh);const cctx=crop.getContext('2d');if(cctx){cctx.drawImage(canvas,sx,sy,sw,sh,0,0,sw,sh);imageCanvas=crop}
  }

  const wrap=document.createElement('div');wrap.className='client-report-source-preview-card';
  const caption=document.createElement('div');caption.className='client-report-source-preview-caption';
  const extra=highlightContainers.length?` · ${highlightContainers.join(' / ')}`:'';caption.textContent=`Print do PDF · ${info.filename} · página ${info.page}${extra} · clique para ampliar`;
  const img=document.createElement('img');img.className='client-report-source-preview-image';img.alt=`Print da fonte em ${info.filename}, página ${info.page}`;img.src=imageCanvas.toDataURL('image/png');img.title='Clique para ampliar';img.tabIndex=0;img.setAttribute('role','button');
  img.addEventListener('click',()=>openPreviewModal(img.src,img.alt));img.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openPreviewModal(img.src,img.alt)}});
  if(!boxes.length){const note=document.createElement('div');note.className='client-report-preview-marker-note';note.textContent='A página correta foi localizada, mas o texto não possui coordenadas suficientes para marcar exatamente o valor.';wrap.append(caption,note,img)}else wrap.append(caption,img);
  container.appendChild(wrap);
}

async function buildPdfPreview(row:HTMLElement,sourceText:string,container:HTMLElement){
  if(container.dataset.loaded==='true'||container.dataset.loading==='true')return;container.dataset.loading='true';container.innerHTML='<div class="client-report-preview-loading">Gerando print da fonte...</div>';
  try{
    const {label}=rowInfo(row);container.replaceChildren();
    if(/Cont[eê]ineres/i.test(label)){
      const sources=await locateContainerSources(row);
      if(!sources.length)throw new Error('Não foi possível localizar visualmente os contêineres nos PDFs desta análise.');
      for(const source of sources)await renderPreviewCard(row,source.candidate.bytes,{kind:source.candidate.kind,filename:source.candidate.filename,page:source.page},sourceText,container,source.containers);
      container.dataset.loaded='true';return;
    }
    let info=sourceInfo(sourceText),bytes:ArrayBuffer|null=null;if(info)bytes=await sourcePdfBytes(sourceText);
    if(!info||!bytes){const fallback=await locateFallbackSource(row,sourceText);if(!fallback)throw new Error('Não foi possível localizar visualmente a origem desta informação nos PDFs desta análise.');info={kind:fallback.candidate.kind,filename:fallback.candidate.filename,page:fallback.page};bytes=fallback.candidate.bytes}
    await renderPreviewCard(row,bytes,info,sourceText,container);container.dataset.loaded='true';
  }catch(error){container.innerHTML=`<div class="client-report-preview-unavailable">${esc(error instanceof Error?error.message:'Não foi possível gerar o print da fonte.')}</div>`;container.dataset.loaded='true'}finally{delete container.dataset.loading}
}

const enhanceReportSources=(root:ParentNode=document)=>{
  root.querySelectorAll<HTMLElement>('.client-report-row').forEach((row,index)=>{
    if(row.dataset.sourceEnhanced==='true')return;const field=row.querySelector<HTMLElement>('.client-report-field'),source=field?.querySelector<HTMLElement>('span'),confidence=row.querySelector<HTMLElement>('.client-report-confidence');if(!field||!source||!confidence)return;
    const sourceText=source.textContent?.trim()||'Fonte não informada.';source.remove();const statusText=document.createElement('span');statusText.className='client-report-confidence-text';while(confidence.firstChild)statusText.appendChild(confidence.firstChild);
    const toggle=document.createElement('button');toggle.type='button';toggle.className='client-report-source-toggle';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Mostrar fonte desta informação');toggle.innerHTML='<span aria-hidden="true">⌄</span>';
    const detail=document.createElement('div');detail.className='client-report-source-detail';detail.id=`client-report-source-${Date.now()}-${index}`;detail.hidden=true;detail.innerHTML=`<b>Fonte da informação</b><span>${esc(sourceText)}</span><div class="client-report-source-preview"></div>`;const preview=detail.querySelector<HTMLElement>('.client-report-source-preview')!;
    toggle.setAttribute('aria-controls',detail.id);confidence.append(statusText,toggle);row.appendChild(detail);
    toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')==='true';toggle.setAttribute('aria-expanded',String(!open));toggle.setAttribute('aria-label',open?'Mostrar fonte desta informação':'Ocultar fonte desta informação');detail.hidden=open;row.classList.toggle('source-open',!open);if(!open)void buildPdfPreview(row,sourceText,preview)});row.dataset.sourceEnhanced='true';
  });
};
const observer=new MutationObserver(mutations=>{for(const mutation of mutations)for(const node of mutation.addedNodes){if(!(node instanceof Element))continue;if(node.matches('.client-report-row')||node.querySelector('.client-report-row'))enhanceReportSources(node.matches('.client-report-row')?node.parentNode||document:node)}});
const start=()=>{enhanceReportSources();observer.observe(document.documentElement,{childList:true,subtree:true})};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
