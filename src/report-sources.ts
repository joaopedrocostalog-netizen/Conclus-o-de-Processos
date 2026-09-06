import JSZip from 'jszip';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const esc=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]||char));
const norm=(value:string)=>value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');

type SourceInfo={kind:string;filename:string;page:number};
type Candidate={kind:string;filename:string;bytes:ArrayBuffer};
type PdfTextItem={str?:string;transform?:number[];width?:number;height?:number};

const sourceInfo=(sourceText:string):SourceInfo|null=>{
  const match=sourceText.match(/^(DOC COMPLETO|NF FISCAL|ZIP PDF)\s*·\s*(.*?)\s*·\s*página\s*(\d+)/i);
  if(!match)return null;
  return{kind:match[1].toUpperCase(),filename:match[2].trim(),page:Number(match[3])};
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
      const pdfEntries=Object.values(zip.files).filter(item=>!item.dir&&/\.pdf$/i.test(item.name));
      const zipped=await Promise.all(pdfEntries.map(async entry=>({kind:'ZIP PDF',filename:entry.name,bytes:await entry.async('arraybuffer')})));
      out.push(...zipped);
    }
    return out;
  })();
  return candidatesPromise;
}

function resetCandidateCache(){candidatesPromise=null}
document.addEventListener('change',event=>{if(event.target instanceof HTMLInputElement&&event.target.type==='file')resetCandidateCache()});

async function sourcePdfBytes(sourceText:string):Promise<ArrayBuffer|null>{
  const info=sourceInfo(sourceText);
  if(!info)return null;
  const candidates=await getCandidates();
  const wanted=info.filename.replace(/\\/g,'/').toLowerCase();
  const wantedBase=wanted.split('/').pop()||wanted;
  const found=candidates.find(item=>{
    if(item.kind!==info.kind)return false;
    const name=item.filename.replace(/\\/g,'/').toLowerCase();
    return name===wanted||name.endsWith('/'+wantedBase)||(name.split('/').pop()===wantedBase);
  });
  return found?.bytes||null;
}

const fieldSearchTerms=(row:HTMLElement)=>{
  const label=row.querySelector<HTMLElement>('.client-report-field b')?.textContent?.trim()||'';
  const value=row.querySelector<HTMLElement>('.client-report-value')?.textContent?.trim()||'';
  const terms:string[]=[];
  if(/^Cliente$/i.test(label)){
    terms.push('TRANSPORTADOR / VOLUMES TRANSPORTADOS','RAZÃO SOCIAL');
    if(value)terms.push(value);
  }else if(/CNPJ do Cliente/i.test(label)){
    terms.push('TRANSPORTADOR / VOLUMES TRANSPORTADOS','CNPJ / CPF');
    if(value)terms.push(value);
  }else if(/Nº\s*BL|AWB/i.test(label)){
    if(value)terms.push(value);
    terms.push('B/L No','Bill of Lading');
  }else if(/Cont[eê]ineres/i.test(label)){
    const containers=value.match(/[A-Z]{4}[-\s]?\d{7}/gi)||[];
    terms.push(...containers.map(v=>v.replace(/[-\s]/g,'')));
    if(value)terms.push(value.split('/')[0].trim());
  }else if(/Tipo Documento/i.test(label)){
    if(/DUIMP/i.test(value))terms.push('DUIMP');
    if(/DUE/i.test(value))terms.push('DUE');
    if(/NF-?e/i.test(value))terms.push('DANFE','NF-e');
    if(/\bBL\b/i.test(value))terms.push('B/L No','Bill of Lading');
  }else if(value){
    terms.push(value);
  }
  return{label,value,terms:[...new Set(terms.filter(Boolean))]};
};

async function locateFallbackSource(row:HTMLElement):Promise<{candidate:Candidate;page:number}|null>{
  const {label,value,terms}=fieldSearchTerms(row);
  const candidates=await getCandidates();
  if(!candidates.length)return null;
  const normalizedValue=norm(value);
  const filenameScore=(candidate:Candidate)=>{
    const name=norm(candidate.filename);let score=0;
    if(/^Cliente$/i.test(label)&&/NFE|NF-E|DANFE/i.test(candidate.filename))score+=120;
    if(/CNPJ do Cliente/i.test(label)&&/NFE|NF-E|DANFE/i.test(candidate.filename))score+=120;
    if(/Nº\s*BL|AWB/i.test(label)&&normalizedValue&&name.includes(normalizedValue))score+=100;
    if(/Tipo Documento/i.test(label)){
      if(/DUIMP/i.test(value)&&/DUIMP/i.test(candidate.filename))score+=80;
      if(/NF-?e/i.test(value)&&/NFE|DANFE/i.test(candidate.filename))score+=70;
      if(/\bBL\b/i.test(value)&&/(^|[^A-Z])BL([^A-Z]|$)|LADING/i.test(candidate.filename.toUpperCase()))score+=60;
    }
    if(/Cont[eê]ineres/i.test(label)&&/DUIMP|NFE|NF-E/i.test(candidate.filename))score+=35;
    return score;
  };
  const ordered=[...candidates].sort((a,b)=>filenameScore(b)-filenameScore(a));
  for(const candidate of ordered){
    const score=filenameScore(candidate);
    try{
      const pdf=await getDocument({data:new Uint8Array(candidate.bytes.slice(0))}).promise;
      for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
        const page=await pdf.getPage(pageNumber);const content=await page.getTextContent();
        const pageText=(content.items as PdfTextItem[]).map(item=>String(item?.str||'')).join(' ');const normalizedPage=norm(pageText);
        if((/^Cliente$/i.test(label)||/CNPJ do Cliente/i.test(label))&&score>=120&&normalizedPage.includes('TRANSPORTADORVOLUMESTRANSPORTADOS'))return{candidate,page:pageNumber};
        const found=terms.some(term=>{const n=norm(term);return n.length>=3&&normalizedPage.includes(n)});
        if(found)return{candidate,page:pageNumber};
      }
    }catch{}
    if(score>=100)return{candidate,page:1};
  }
  return null;
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

function itemBox(item:PdfTextItem,viewport:any,scale:number){
  const t=item.transform||[];const x=Number(t[4]||0),y=Number(t[5]||0);const [vx,vy]=viewport.convertToViewportPoint(x,y);
  const w=Math.max(18,Number(item.width||0)*scale);const h=Math.max(12,Number(item.height||9)*scale);
  return{x:vx,y:vy-h,w,h,cx:vx+w/2,cy:vy-h/2};
}

function bestAnchoredItem(items:PdfTextItem[],viewport:any,scale:number,label:string,value:string){
  const usable=items.filter(item=>String(item.str||'').trim()&&item.transform);
  const valueNorm=norm(value);
  const exactMatches=usable.filter(item=>{
    const text=norm(String(item.str||''));
    if(!text||text.length<3)return false;
    return text===valueNorm||(valueNorm.length>=6&&text.length>=6&&(text.includes(valueNorm)||valueNorm.includes(text)));
  });

  const anchorTerms=/^Cliente$/i.test(label)?['RAZAOSOCIAL']:/CNPJ do Cliente/i.test(label)?['CNPJCPF']:[];
  const anchors=usable.filter(item=>anchorTerms.some(term=>norm(String(item.str||'')).includes(term)));
  if(!anchors.length)return exactMatches[0]||null;

  const scoreCandidate=(candidate:PdfTextItem)=>{
    const cb=itemBox(candidate,viewport,scale);
    let best=Number.POSITIVE_INFINITY;
    for(const anchor of anchors){
      const ab=itemBox(anchor,viewport,scale);
      const vertical=cb.cy-ab.cy;
      const horizontal=Math.abs(cb.cx-ab.cx);
      // DANFE: o valor correto fica no mesmo quadro, normalmente imediatamente abaixo do rótulo.
      // Penaliza fortemente ocorrências distantes, evitando Remetente/Destinatário e outros CNPJs.
      const distance=Math.abs(vertical)*2+horizontal;
      const sameBand=Math.abs(vertical)<90?0:500;
      best=Math.min(best,distance+sameBand);
    }
    return best;
  };
  if(exactMatches.length)return [...exactMatches].sort((a,b)=>scoreCandidate(a)-scoreCandidate(b))[0];

  // Se o texto veio fragmentado pelo PDF, procura o item mais próximo do rótulo dentro do quadro.
  const nearby=usable.filter(item=>{
    const text=norm(String(item.str||''));
    if(text.length<4||anchorTerms.some(term=>text.includes(term)))return false;
    return anchors.some(anchor=>{
      const a=itemBox(anchor,viewport,scale),b=itemBox(item,viewport,scale);
      return Math.abs(b.cy-a.cy)<75&&Math.abs(b.cx-a.cx)<260;
    });
  });
  return nearby.sort((a,b)=>scoreCandidate(a)-scoreCandidate(b))[0]||null;
}

async function renderPreview(row:HTMLElement,bytes:ArrayBuffer,info:SourceInfo,container:HTMLElement){
  const pdf=await getDocument({data:new Uint8Array(bytes.slice(0))}).promise;
  if(info.page<1||info.page>pdf.numPages)throw new Error('Página da fonte não localizada no PDF.');
  const page=await pdf.getPage(info.page);const scale=1.35;const viewport=page.getViewport({scale});
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Não foi possível criar a prévia.');await page.render({canvas,canvasContext:ctx,viewport}).promise;

  const {label,value,terms}=fieldSearchTerms(row);let target:PdfTextItem|null=null;let targetBox:{x:number;y:number;w:number;h:number;cx:number;cy:number}|null=null;
  try{
    const content=await page.getTextContent();const items=content.items as PdfTextItem[];
    if(/^Cliente$/i.test(label)||/CNPJ do Cliente/i.test(label)){
      target=bestAnchoredItem(items,viewport,scale,label,value);
    }else{
      const needles=[value,...terms].map(norm).filter(v=>v.length>=4);
      // Não aceita mais fragmentos curtos do valor como "GLOVIS"; isso era o que podia marcar o bloco errado.
      target=items.find(raw=>{
        const text=norm(String(raw?.str||''));
        return text.length>=4&&needles.some(needle=>text===needle||(text.length>=6&&needle.length>=6&&(text.includes(needle)||needle.includes(text))));
      })||null;
    }
    if(target?.transform){
      targetBox=itemBox(target,viewport,scale);ctx.save();ctx.strokeStyle='#c8102e';ctx.lineWidth=3;ctx.fillStyle='rgba(200,16,46,.10)';
      ctx.fillRect(Math.max(0,targetBox.x-8),Math.max(0,targetBox.y-8),Math.min(canvas.width-targetBox.x+8,targetBox.w+16),targetBox.h+16);
      ctx.strokeRect(Math.max(0,targetBox.x-8),Math.max(0,targetBox.y-8),Math.min(canvas.width-targetBox.x+8,targetBox.w+16),targetBox.h+16);ctx.restore();
    }
  }catch{}

  let imageCanvas=canvas;
  // Para Cliente/CNPJ, mostra um recorte do quadro correto em vez de uma página inteira ambígua.
  if(targetBox&&(/^Cliente$/i.test(label)||/CNPJ do Cliente/i.test(label))){
    const padX=170,padY=85;const sx=Math.max(0,Math.floor(targetBox.x-padX));const sy=Math.max(0,Math.floor(targetBox.y-padY));
    const sw=Math.min(canvas.width-sx,Math.ceil(targetBox.w+padX*2));const sh=Math.min(canvas.height-sy,Math.ceil(targetBox.h+padY*2));
    const crop=document.createElement('canvas');crop.width=Math.max(1,sw);crop.height=Math.max(1,sh);const cropCtx=crop.getContext('2d');
    if(cropCtx){cropCtx.drawImage(canvas,sx,sy,sw,sh,0,0,sw,sh);imageCanvas=crop}
  }

  const img=document.createElement('img');img.className='client-report-source-preview-image';img.alt=`Print da fonte em ${info.filename}, página ${info.page}`;img.src=imageCanvas.toDataURL('image/png');
  img.title='Clique para ampliar';img.tabIndex=0;img.setAttribute('role','button');img.addEventListener('click',()=>openPreviewModal(img.src,img.alt));
  img.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openPreviewModal(img.src,img.alt)}});
  const caption=document.createElement('div');caption.className='client-report-source-preview-caption';
  caption.textContent=`Print do PDF · ${info.filename} · página ${info.page} · clique para ampliar`;
  container.replaceChildren(caption,img);container.dataset.loaded='true';
}

async function buildPdfPreview(row:HTMLElement,sourceText:string,container:HTMLElement){
  if(container.dataset.loaded==='true'||container.dataset.loading==='true')return;
  container.dataset.loading='true';container.innerHTML='<div class="client-report-preview-loading">Gerando print da fonte...</div>';
  try{
    let info=sourceInfo(sourceText);let bytes:ArrayBuffer|null=null;if(info)bytes=await sourcePdfBytes(sourceText);
    if(!info||!bytes){const fallback=await locateFallbackSource(row);if(!fallback)throw new Error('Não foi possível localizar visualmente a origem desta informação nos PDFs desta análise.');info={kind:fallback.candidate.kind,filename:fallback.candidate.filename,page:fallback.page};bytes=fallback.candidate.bytes}
    await renderPreview(row,bytes,info,container);
  }catch(error){container.innerHTML=`<div class="client-report-preview-unavailable">${esc(error instanceof Error?error.message:'Não foi possível gerar o print da fonte.')}</div>`;container.dataset.loaded='true'}finally{delete container.dataset.loading}
}

const enhanceReportSources = (root: ParentNode = document) => {
  root.querySelectorAll<HTMLElement>('.client-report-row').forEach((row, index) => {
    if (row.dataset.sourceEnhanced === 'true') return;
    const field=row.querySelector<HTMLElement>('.client-report-field');const source=field?.querySelector<HTMLElement>('span');const confidence=row.querySelector<HTMLElement>('.client-report-confidence');if(!field||!source||!confidence)return;
    const sourceText=source.textContent?.trim()||'Fonte não informada.';source.remove();const statusText=document.createElement('span');statusText.className='client-report-confidence-text';while(confidence.firstChild)statusText.appendChild(confidence.firstChild);
    const toggle=document.createElement('button');toggle.type='button';toggle.className='client-report-source-toggle';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Mostrar fonte desta informação');toggle.innerHTML='<span aria-hidden="true">⌄</span>';
    const detail=document.createElement('div');detail.className='client-report-source-detail';detail.id=`client-report-source-${Date.now()}-${index}`;detail.hidden=true;detail.innerHTML=`<b>Fonte da informação</b><span>${esc(sourceText)}</span><div class="client-report-source-preview"></div>`;
    const preview=detail.querySelector<HTMLElement>('.client-report-source-preview')!;toggle.setAttribute('aria-controls',detail.id);confidence.appendChild(statusText);confidence.appendChild(toggle);row.appendChild(detail);
    toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')==='true';toggle.setAttribute('aria-expanded',String(!open));toggle.setAttribute('aria-label',open?'Mostrar fonte desta informação':'Ocultar fonte desta informação');detail.hidden=open;row.classList.toggle('source-open',!open);if(!open)void buildPdfPreview(row,sourceText,preview)});row.dataset.sourceEnhanced='true';
  });
};

const observer=new MutationObserver(mutations=>{for(const mutation of mutations)for(const node of mutation.addedNodes){if(!(node instanceof Element))continue;if(node.matches('.client-report-row')||node.querySelector('.client-report-row'))enhanceReportSources(node.matches('.client-report-row')?node.parentNode||document:node)}});
const start=()=>{enhanceReportSources();observer.observe(document.documentElement,{childList:true,subtree:true})};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
