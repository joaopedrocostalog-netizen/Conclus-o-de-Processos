import JSZip from 'jszip';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();

export {};

type PdfTextItem={str?:string;transform?:number[];width?:number;height?:number};
type Candidate={filename:string;bytes:ArrayBuffer};
type Box={x:number;y:number;w:number;h:number};
type ExactHit={candidate:Candidate;pageNumber:number;mode:'carrier'|'signed'};

const norm=(value:string)=>value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');
const textOf=(item:PdfTextItem)=>String(item.str||'').trim();

async function inputPdfs():Promise<Candidate[]>{
  const out:Candidate[]=[];
  const pdfInput=document.querySelector<HTMLInputElement>('[data-iguasport-file="pdfs"]');
  for(const file of [...(pdfInput?.files||[])])out.push({filename:file.name,bytes:await file.arrayBuffer()});
  const zipFile=document.querySelector<HTMLInputElement>('[data-iguasport-file="zip"]')?.files?.[0];
  if(zipFile){
    const zip=await JSZip.loadAsync(zipFile);
    for(const entry of Object.values(zip.files).filter(e=>!e.dir&&/\.pdf$/i.test(e.name))){
      out.push({filename:entry.name,bytes:await entry.async('arraybuffer')});
    }
  }
  return out;
}

function itemBox(item:PdfTextItem,viewport:any,scale:number):Box{
  const t=item.transform||[];
  const [x,yBase]=viewport.convertToViewportPoint(Number(t[4]||0),Number(t[5]||0));
  const w=Math.max(18,Number(item.width||0)*scale),h=Math.max(12,Number(item.height||9)*scale);
  return{x,y:yBase-h,w,h};
}
function drawBox(ctx:CanvasRenderingContext2D,canvas:HTMLCanvasElement,box:Box,pad=7){
  const x=Math.max(0,box.x-pad),y=Math.max(0,box.y-pad),w=Math.min(canvas.width-x,box.w+pad*2),h=Math.min(canvas.height-y,box.h+pad*2);
  ctx.save();ctx.strokeStyle='#c8102e';ctx.lineWidth=4;ctx.fillStyle='rgba(200,16,46,.14)';ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);ctx.restore();
}
function valueBoxInsideCombinedItem(item:PdfTextItem,value:string,viewport:any,scale:number):Box{
  const base=itemBox(item,viewport,scale),raw=textOf(item),rawLower=raw.toLowerCase(),valueLower=value.toLowerCase();
  let index=rawLower.indexOf(valueLower);
  if(index<0){
    const carrierIndex=rawLower.indexOf('carrier');
    if(carrierIndex>=0)index=carrierIndex+'carrier'.length;
  }
  if(index<0)return base;
  const start=Math.max(0,index/Math.max(1,raw.length)),len=Math.min(1,Math.max(value.length/Math.max(1,raw.length),.12));
  return{x:base.x+base.w*start,y:base.y,w:Math.max(24,base.w*len),h:base.h};
}

function findAgencyBox(items:PdfTextItem[],value:string,viewport:any,scale:number):Box|null{
  const usable=items.filter(i=>textOf(i)&&i.transform),nv=norm(value);

  // Prefer the explicit CARRIER block (e.g. "CARRIER: CMA CGM Société Anonyme...").
  const carrierCombined=usable.find(i=>{
    const t=norm(textOf(i));
    return t.includes('CARRIER')&&nv&&t.includes(nv)&&!t.includes('SIGNEDFORTHECARRIER');
  });
  if(carrierCombined)return valueBoxInsideCombinedItem(carrierCombined,value,viewport,scale);

  const carrierAnchors=usable.filter(i=>/^\s*CARRIER\s*:?\s*$/i.test(textOf(i))||norm(textOf(i))==='CARRIER');
  const values=usable.filter(i=>{const t=norm(textOf(i));return nv&&(t===nv||t.includes(nv)||nv.includes(t))});
  if(carrierAnchors.length&&values.length){
    let best:{box:Box;score:number}|null=null;
    for(const valueItem of values){
      const vb=itemBox(valueItem,viewport,scale);
      for(const anchor of carrierAnchors){
        const ab=itemBox(anchor,viewport,scale),dy=Math.abs((vb.y+vb.h/2)-(ab.y+ab.h/2)),dx=Math.abs(vb.x-(ab.x+ab.w));
        const score=dy*10+dx+(dy>55?5000:0);
        if(!best||score<best.score)best={box:vb,score};
      }
    }
    if(best&&best.score<5000)return best.box;
  }

  // Fallback for carriers whose BL only has "Signed for the Carrier ...".
  const signedCombined=usable.find(i=>{const t=norm(textOf(i));return t.includes('SIGNEDFORTHECARRIER')&&nv&&t.includes(nv)});
  if(signedCombined)return valueBoxInsideCombinedItem(signedCombined,value,viewport,scale);
  const signedAnchors=usable.filter(i=>norm(textOf(i)).includes('SIGNEDFORTHECARRIER'));
  if(signedAnchors.length&&values.length){
    let best:{box:Box;score:number}|null=null;
    for(const valueItem of values){
      const vb=itemBox(valueItem,viewport,scale);
      for(const anchor of signedAnchors){
        const ab=itemBox(anchor,viewport,scale),dy=Math.abs((vb.y+vb.h/2)-(ab.y+ab.h/2)),dx=Math.abs(vb.x-ab.x),score=dy*8+dx+(dy>45?5000:0);
        if(!best||score<best.score)best={box:vb,score};
      }
    }
    if(best&&best.score<5000)return best.box;
  }
  return null;
}

async function locateExact(value:string):Promise<ExactHit|null>{
  const nv=norm(value),files=await inputPdfs();
  // First choice: exact carrier value in an explicit CARRIER block.
  for(const candidate of files){
    try{
      const pdf=await getDocument({data:new Uint8Array(candidate.bytes.slice(0))}).promise;
      for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
        const page=await pdf.getPage(pageNumber),content=await page.getTextContent(),items=content.items as PdfTextItem[];
        const raw=items.map(textOf).join(' '),joined=norm(raw);
        if(nv&&joined.includes(nv)&&/\bCARRIER\s*:/i.test(raw))return{candidate,pageNumber,mode:'carrier'};
      }
    }catch{}
  }
  // Second choice: Signed for the Carrier + exact value.
  for(const candidate of files){
    try{
      const pdf=await getDocument({data:new Uint8Array(candidate.bytes.slice(0))}).promise;
      for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
        const page=await pdf.getPage(pageNumber),content=await page.getTextContent(),items=content.items as PdfTextItem[];
        const joined=norm(items.map(textOf).join(' '));
        if(nv&&joined.includes(nv)&&joined.includes('SIGNEDFORTHECARRIER'))return{candidate,pageNumber,mode:'signed'};
      }
    }catch{}
  }
  return null;
}

function ensureModal(){
  let modal=document.querySelector<HTMLElement>('.client-report-preview-modal');if(modal)return modal;
  modal=document.createElement('div');modal.className='client-report-preview-modal';modal.hidden=true;
  modal.innerHTML='<button type="button" class="client-report-preview-modal-close" aria-label="Fechar visualização">×</button><div class="client-report-preview-modal-body"><img alt="Visualização ampliada da fonte"></div>';
  document.body.appendChild(modal);const close=()=>{modal!.hidden=true};modal.querySelector('.client-report-preview-modal-close')?.addEventListener('click',close);modal.addEventListener('click',e=>{if(e.target===modal)close()});return modal;
}

async function buildExact(row:HTMLElement,preview:HTMLElement){
  const value=row.querySelector<HTMLElement>('.client-report-value')?.textContent?.trim()||'';
  preview.innerHTML='<div class="client-report-preview-loading">Localizando a agência no bloco CARRIER do BL...</div>';
  const hit=await locateExact(value);
  if(!hit){preview.innerHTML='<div class="client-report-preview-unavailable">Não foi possível localizar a agência junto de “CARRIER:” ou “Signed for the Carrier” neste BL.</div>';return;}
  const pdf=await getDocument({data:new Uint8Array(hit.candidate.bytes.slice(0))}).promise,page=await pdf.getPage(hit.pageNumber),scale=1.6,viewport=page.getViewport({scale});
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext('2d');if(!ctx)return;await page.render({canvas,canvasContext:ctx,viewport}).promise;
  const content=await page.getTextContent(),items=content.items as PdfTextItem[],box=findAgencyBox(items,value,viewport,scale);if(box)drawBox(ctx,canvas,box);
  const wrap=document.createElement('div');wrap.className='client-report-source-preview-card';
  const sourceLabel=hit.mode==='carrier'?'bloco “CARRIER:”':'linha “Signed for the Carrier”';
  const caption=document.createElement('div');caption.className='client-report-source-preview-caption';caption.textContent=`Print do PDF · ${hit.candidate.filename} · página ${hit.pageNumber} · ${sourceLabel}`;
  const img=document.createElement('img');img.className='client-report-source-preview-image';img.alt=`Agência Marítima em ${hit.candidate.filename}, página ${hit.pageNumber}`;img.src=canvas.toDataURL('image/png');img.tabIndex=0;img.setAttribute('role','button');
  const open=()=>{const modal=ensureModal(),modalImg=modal.querySelector<HTMLImageElement>('img');if(modalImg){modalImg.src=img.src;modalImg.alt=img.alt;modal.hidden=false}};
  img.addEventListener('click',open);img.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}});wrap.append(caption,img);preview.replaceChildren(wrap);
}

window.addEventListener('click',event=>{
  const target=event.target;if(!(target instanceof Element))return;
  const toggle=target.closest<HTMLButtonElement>('.iguasport-report-view .client-report-source-toggle');if(!toggle)return;
  const row=toggle.closest<HTMLElement>('.client-report-row'),label=row?.querySelector<HTMLElement>('.client-report-field b')?.textContent?.trim()||'';
  if(!row||!/^Agência Marítima$/i.test(label))return;
  const detail=row.querySelector<HTMLElement>('.client-report-source-detail'),preview=detail?.querySelector<HTMLElement>('.client-report-source-preview');if(!detail||!preview)return;
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
  const isOpen=toggle.getAttribute('aria-expanded')==='true';toggle.setAttribute('aria-expanded',String(!isOpen));detail.hidden=isOpen;row.classList.toggle('source-open',!isOpen);
  if(!isOpen)void buildExact(row,preview);
},true);
