import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

type PdfTextItem={str?:string;transform?:number[];width?:number;height?:number};
type Box={x:number;y:number;w:number;h:number};

const norm=(value:string)=>value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');

function rowIsWeight(row:HTMLElement){
  const label=row.querySelector<HTMLElement>('.client-report-field b')?.textContent?.trim()||'';
  return /Peso\s+L[ií]quido/i.test(label);
}

function weightValue(row:HTMLElement){
  return row.querySelector<HTMLElement>('.client-report-value')?.textContent?.trim()||'';
}

function itemBox(item:PdfTextItem,viewport:any,scale:number):Box{
  const t=item.transform||[];
  const [vx,vy]=viewport.convertToViewportPoint(Number(t[4]||0),Number(t[5]||0));
  const w=Math.max(18,Number(item.width||0)*scale),h=Math.max(12,Number(item.height||9)*scale);
  return{x:vx,y:vy-h,w,h};
}

function drawBox(ctx:CanvasRenderingContext2D,canvas:HTMLCanvasElement,box:Box,pad=8){
  const x=Math.max(0,box.x-pad),y=Math.max(0,box.y-pad),w=Math.min(canvas.width-x,box.w+pad*2),h=Math.min(canvas.height-y,box.h+pad*2);
  ctx.save();
  ctx.strokeStyle='#c8102e';ctx.lineWidth=4;ctx.fillStyle='rgba(200,16,46,.14)';
  ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);ctx.restore();
}

function numberCandidates(value:string){
  const raw=value.replace(/\s*kg\s*/ig,'').trim();
  const digits=raw.replace(/[^0-9]/g,'');
  const variants=[raw,digits];
  if(raw.includes(',')) variants.push(raw.replace(/\./g,''),raw.replace(/\./g,'').replace(',','.'));
  return [...new Set(variants.map(norm).filter(v=>v.length>=4))];
}

function bestWeightTarget(items:PdfTextItem[],viewport:any,scale:number,value:string){
  const usable=items.filter(item=>item.transform&&String(item.str||'').trim());
  const anchors=usable.filter(item=>norm(String(item.str||'')).includes('PESOLIQUIDO'));
  const values=numberCandidates(value);
  const matches=usable.filter(item=>{
    const text=norm(String(item.str||''));
    return values.some(v=>text===v||(text.length>=4&&v.length>=4&&(text.includes(v)||v.includes(text))));
  });
  if(matches.length&&anchors.length){
    const score=(candidate:PdfTextItem)=>{
      const b=itemBox(candidate,viewport,scale);let best=Infinity;
      for(const anchor of anchors){
        const a=itemBox(anchor,viewport,scale);
        best=Math.min(best,Math.abs((b.y+b.h/2)-(a.y+a.h/2))*2+Math.abs((b.x+b.w/2)-(a.x+a.w/2)));
      }
      return best;
    };
    return [...matches].sort((a,b)=>score(a)-score(b))[0];
  }
  return matches[0]||anchors[0]||null;
}

async function findWeightPage(file:File,kind:'DOC COMPLETO'|'NF FISCAL'){
  const bytes=await file.arrayBuffer();
  const pdf=await getDocument({data:new Uint8Array(bytes.slice(0))}).promise;
  const order=kind==='DOC COMPLETO'
    ? [...new Set([5,1,...Array.from({length:pdf.numPages},(_,i)=>i+1)])].filter(n=>n<=pdf.numPages)
    : [...new Set([1,...Array.from({length:pdf.numPages},(_,i)=>i+1)])];
  for(const n of order){
    const page=await pdf.getPage(n);
    const content=await page.getTextContent();
    const text=(content.items as PdfTextItem[]).map(i=>String(i.str||'')).join(' ');
    const normalized=norm(text);
    if(kind==='DOC COMPLETO'){
      if(normalized.includes('PESOLIQUIDO')||normalized.includes('PESOLIQUIDOKG'))return{bytes,page:n};
    }else{
      if(normalized.includes('TRANSPORTADORVOLUMESTRANSPORTADOS')&&normalized.includes('PESOLIQUIDO'))return{bytes,page:n};
      if(normalized.includes('PESOLIQUIDO'))return{bytes,page:n};
    }
  }
  return null;
}

function openModal(src:string,alt:string){
  const existing=document.querySelector<HTMLElement>('.client-report-preview-modal');
  const img=existing?.querySelector<HTMLImageElement>('img');
  if(existing&&img){img.src=src;img.alt=alt;existing.hidden=false;return;}
  const modal=document.createElement('div');modal.className='client-report-preview-modal';
  modal.innerHTML='<button type="button" class="client-report-preview-modal-close" aria-label="Fechar visualização">×</button><div class="client-report-preview-modal-body"><img alt="Visualização ampliada da fonte"></div>';
  document.body.appendChild(modal);
  const image=modal.querySelector<HTMLImageElement>('img')!;image.src=src;image.alt=alt;
  const close=()=>modal.remove();
  modal.addEventListener('click',e=>{if(e.target===modal)close()});
  modal.querySelector('.client-report-preview-modal-close')?.addEventListener('click',close);
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){close();document.removeEventListener('keydown',key)}};
  document.addEventListener('keydown',key);
}

async function makeCard(row:HTMLElement,file:File,kind:'DOC COMPLETO'|'NF FISCAL',pageNumber:number,bytes:ArrayBuffer,container:HTMLElement){
  const pdf=await getDocument({data:new Uint8Array(bytes.slice(0))}).promise;
  const page=await pdf.getPage(pageNumber),scale=1.45,viewport=page.getViewport({scale});
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext('2d');if(!ctx)return;
  await page.render({canvas,canvasContext:ctx,viewport}).promise;

  let box:Box|null=null;
  try{
    const content=await page.getTextContent();
    const target=bestWeightTarget(content.items as PdfTextItem[],viewport,scale,weightValue(row));
    if(target){box=itemBox(target,viewport,scale);drawBox(ctx,canvas,box)}
  }catch{}

  let imageCanvas=canvas;
  if(box){
    const padX=220,padY=120,sx=Math.max(0,Math.floor(box.x-padX)),sy=Math.max(0,Math.floor(box.y-padY));
    const sw=Math.min(canvas.width-sx,Math.ceil(box.w+padX*2)),sh=Math.min(canvas.height-sy,Math.ceil(box.h+padY*2));
    const crop=document.createElement('canvas');crop.width=Math.max(1,sw);crop.height=Math.max(1,sh);
    const cctx=crop.getContext('2d');if(cctx){cctx.drawImage(canvas,sx,sy,sw,sh,0,0,sw,sh);imageCanvas=crop}
  }

  const wrap=document.createElement('div');wrap.className='client-report-source-preview-card';
  const caption=document.createElement('div');caption.className='client-report-source-preview-caption';
  caption.textContent=`${kind} · ${file.name} · página ${pageNumber} · Peso Líquido · clique para ampliar`;
  const img=document.createElement('img');img.className='client-report-source-preview-image';img.alt=`Peso Líquido em ${file.name}, página ${pageNumber}`;img.src=imageCanvas.toDataURL('image/png');img.title='Clique para ampliar';img.tabIndex=0;img.setAttribute('role','button');
  img.addEventListener('click',()=>openModal(img.src,img.alt));
  img.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openModal(img.src,img.alt)}});
  if(!box){
    const note=document.createElement('div');note.className='client-report-preview-marker-note';
    note.textContent='A página do Peso Líquido foi localizada, mas o PDF não forneceu coordenadas suficientes para marcar exatamente o valor.';
    wrap.append(caption,note,img);
  }else wrap.append(caption,img);
  container.appendChild(wrap);
}

async function buildWeightPreview(row:HTMLElement){
  const container=row.querySelector<HTMLElement>('.client-report-source-preview');
  if(!container||container.dataset.weightFixed==='true'||container.dataset.weightFixLoading==='true')return;
  container.dataset.weightFixLoading='true';
  try{
    const doc=document.querySelector<HTMLInputElement>('[data-client-file="doc"]')?.files?.[0]||null;
    const nf=document.querySelector<HTMLInputElement>('[data-client-file="nf"]')?.files?.[0]||null;
    const found:Array<{file:File;kind:'DOC COMPLETO'|'NF FISCAL';page:number;bytes:ArrayBuffer}> = [];
    if(doc){const hit=await findWeightPage(doc,'DOC COMPLETO');if(hit)found.push({file:doc,kind:'DOC COMPLETO',page:hit.page,bytes:hit.bytes})}
    if(nf){const hit=await findWeightPage(nf,'NF FISCAL');if(hit)found.push({file:nf,kind:'NF FISCAL',page:hit.page,bytes:hit.bytes})}
    if(!found.length)return;
    container.replaceChildren();
    for(const hit of found)await makeCard(row,hit.file,hit.kind,hit.page,hit.bytes,container);
    container.dataset.weightFixed='true';
  }finally{delete container.dataset.weightFixLoading}
}

async function waitAndFix(row:HTMLElement){
  const container=row.querySelector<HTMLElement>('.client-report-source-preview');if(!container)return;
  const start=performance.now();
  while(container.dataset.loading==='true'&&performance.now()-start<10000)await new Promise(r=>setTimeout(r,80));
  await buildWeightPreview(row);
}

document.addEventListener('click',event=>{
  const target=event.target as Element|null;
  const toggle=target?.closest?.('.client-report-source-toggle');if(!toggle)return;
  const row=toggle.closest<HTMLElement>('.client-report-row');if(!row||!rowIsWeight(row))return;
  setTimeout(()=>{
    if(toggle.getAttribute('aria-expanded')==='true')void waitAndFix(row);
  },160);
});

const observer=new MutationObserver(()=>{
  document.querySelectorAll<HTMLElement>('.client-report-row').forEach(row=>{
    if(!rowIsWeight(row))return;
    const detail=row.querySelector<HTMLElement>('.client-report-source-detail');
    if(detail&&!detail.hidden&&row.querySelector('.client-report-preview-unavailable'))void buildWeightPreview(row);
  });
});
observer.observe(document.documentElement,{childList:true,subtree:true});