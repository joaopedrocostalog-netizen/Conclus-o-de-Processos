import { getDocument } from 'pdfjs-dist';

type Item={str?:string;transform?:number[];width?:number;height?:number};

const norm=(value:string)=>value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');
const digits=(value:string)=>value.replace(/\D/g,'');

function ensureModal(){
  let modal=document.querySelector<HTMLElement>('.client-report-preview-modal');
  if(modal)return modal;
  modal=document.createElement('div');
  modal.className='client-report-preview-modal';
  modal.hidden=true;
  modal.innerHTML='<button type="button" class="client-report-preview-modal-close" aria-label="Fechar visualização">×</button><div class="client-report-preview-modal-body"><img alt="Visualização ampliada da fonte"></div>';
  document.body.appendChild(modal);
  const close=()=>{if(modal)modal.hidden=true};
  modal.addEventListener('click',event=>{if(event.target===modal)close()});
  modal.querySelector('.client-report-preview-modal-close')?.addEventListener('click',close);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&modal&&!modal.hidden)close()});
  return modal;
}

function openModal(src:string,alt:string){
  const modal=ensureModal();
  const img=modal.querySelector<HTMLImageElement>('img');
  if(!img)return;
  img.src=src;
  img.alt=alt;
  modal.hidden=false;
}

function box(item:Item,viewport:any,scale:number){
  const t=item.transform||[];
  const [x0,y0]=viewport.convertToViewportPoint(Number(t[4]||0),Number(t[5]||0));
  const w=Math.max(24,Number(item.width||0)*scale);
  const h=Math.max(14,Number(item.height||9)*scale);
  return{x:x0,y:y0-h,w,h};
}

async function renderEvidence(file:File,pageNumber:number,reportValue:string,label:string){
  const pdf=await getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  if(pageNumber<1||pageNumber>pdf.numPages)return null;
  const page=await pdf.getPage(pageNumber);
  const scale=1.55;
  const viewport=page.getViewport({scale});
  const canvas=document.createElement('canvas');
  canvas.width=Math.ceil(viewport.width);
  canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext('2d');
  if(!ctx)return null;
  await page.render({canvas,canvasContext:ctx,viewport}).promise;

  const content=await page.getTextContent();
  const items=(content.items as Item[]).filter(item=>String(item.str||'').trim()&&item.transform);
  const anchors=items.filter(item=>/PESO\s+L[IÍ]QUIDO/i.test(String(item.str||''))||norm(String(item.str||'')).includes('PESOLIQUIDO'));
  const wantedDigits=digits(reportValue);
  const valueItems=items.filter(item=>{
    const text=String(item.str||'');
    const itemDigits=digits(text);
    if(itemDigits.length<4||wantedDigits.length<4)return false;
    const common=Math.min(7,itemDigits.length,wantedDigits.length);
    return common>=4&&itemDigits.slice(0,common)===wantedDigits.slice(0,common);
  });

  const marks=[...anchors,...valueItems];
  let minX=canvas.width,maxX=0,minY=canvas.height,maxY=0;
  ctx.save();
  ctx.lineWidth=4;
  ctx.strokeStyle='#c8102e';
  ctx.fillStyle='rgba(200,16,46,.13)';
  for(const item of marks){
    const b=box(item,viewport,scale);
    const x=Math.max(0,b.x-10),y=Math.max(0,b.y-10),w=Math.min(canvas.width-x,b.w+20),h=Math.min(canvas.height-y,b.h+20);
    ctx.fillRect(x,y,w,h);
    ctx.strokeRect(x,y,w,h);
    minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x+w);maxY=Math.max(maxY,y+h);
  }
  ctx.restore();

  if(!marks.length)return null;

  const padX=190,padY=105;
  const sx=Math.max(0,Math.floor(minX-padX));
  const sy=Math.max(0,Math.floor(minY-padY));
  const ex=Math.min(canvas.width,Math.ceil(maxX+padX));
  const ey=Math.min(canvas.height,Math.ceil(maxY+padY));
  const crop=document.createElement('canvas');
  crop.width=Math.max(1,ex-sx);
  crop.height=Math.max(1,ey-sy);
  const cropCtx=crop.getContext('2d');
  if(!cropCtx)return null;
  cropCtx.drawImage(canvas,sx,sy,crop.width,crop.height,0,0,crop.width,crop.height);
  return{src:crop.toDataURL('image/png'),alt:`${label} · ${file.name} · página ${pageNumber}`};
}

async function repairWeightPreview(row:HTMLElement,preview:HTMLElement){
  if(preview.dataset.manualWeightFix==='loading'||preview.dataset.manualWeightFix==='done')return;
  preview.dataset.manualWeightFix='loading';
  const value=row.querySelector<HTMLElement>('.client-report-value')?.textContent?.trim()||'';
  const doc=document.querySelector<HTMLInputElement>('[data-client-file="doc"]')?.files?.[0]||null;
  const nf=document.querySelector<HTMLInputElement>('[data-client-file="nf"]')?.files?.[0]||null;
  const evidences:Array<{src:string;alt:string;caption:string}>=[];

  try{
    if(doc){
      const rendered=await renderEvidence(doc,5,value,'Peso Líquido no DOC COMPLETO');
      if(rendered)evidences.push({...rendered,caption:`DOC COMPLETO · ${doc.name} · página 5 · Peso Líquido`});
    }
    if(nf){
      const rendered=await renderEvidence(nf,1,value,'Peso Líquido na NF Fiscal');
      if(rendered)evidences.push({...rendered,caption:`NF FISCAL · ${nf.name} · página 1 · Transportador / Volumes · Peso Líquido`});
    }

    if(!evidences.length){
      preview.dataset.manualWeightFix='done';
      return;
    }

    const fragment=document.createDocumentFragment();
    evidences.forEach((evidence,index)=>{
      const wrap=document.createElement('div');
      wrap.className='client-report-source-evidence-item';
      const caption=document.createElement('div');
      caption.className='client-report-source-preview-caption';
      caption.textContent=evidence.caption+(evidences.length>1?` · evidência ${index+1}/${evidences.length}`:'');
      const img=document.createElement('img');
      img.className='client-report-source-preview-image';
      img.src=evidence.src;
      img.alt=evidence.alt;
      img.title='Clique para ampliar';
      img.tabIndex=0;
      img.setAttribute('role','button');
      img.addEventListener('click',()=>openModal(img.src,img.alt));
      img.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openModal(img.src,img.alt)}});
      wrap.append(caption,img);
      fragment.appendChild(wrap);
    });
    preview.replaceChildren(fragment);
    preview.dataset.loaded='true';
    preview.dataset.manualWeightFix='done';
  }catch{
    delete preview.dataset.manualWeightFix;
  }
}

function inspect(root:ParentNode=document){
  root.querySelectorAll<HTMLElement>('.client-report-row').forEach(row=>{
    const label=row.querySelector<HTMLElement>('.client-report-field b')?.textContent?.trim()||'';
    if(!/^Peso\s+L[ií]quido$/i.test(label))return;
    const preview=row.querySelector<HTMLElement>('.client-report-source-preview');
    if(!preview)return;
    const unavailable=preview.querySelector('.client-report-preview-unavailable');
    if(unavailable&&/Não foi possível localizar visualmente|origem desta informação|Prévia indisponível/i.test(unavailable.textContent||'')){
      void repairWeightPreview(row,preview);
    }
  });
}

const observer=new MutationObserver(mutations=>{
  for(const mutation of mutations){
    if(mutation.type==='childList')inspect(mutation.target instanceof Element?mutation.target:document);
  }
});

const start=()=>{
  inspect();
  observer.observe(document.documentElement,{childList:true,subtree:true});
};

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
else start();
