import JSZip from 'jszip';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();

export {};

type Kind='DUIMP'|'NF-e'|'BL'|'DARE'|'PDF';
type Candidate={kind:Kind;filename:string;bytes:ArrayBuffer};
type PdfTextItem={str?:string;transform?:number[];width?:number;height?:number};
type Box={x:number;y:number;w:number;h:number;cx:number;cy:number};

const norm=(value:string)=>value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');
const esc=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]||char));
const normalizeContainer=(value:string)=>value.replace(/[^A-Z0-9]/gi,'').toUpperCase();

function classify(text:string,name:string):Kind{
  if(/Extrato\s+da\s+Duimp|\bDUIMP\b/i.test(text))return'DUIMP';
  if(/\bDANFE\b|Nota Fiscal Eletr[oô]nica|VALOR TOTAL DA NOTA/i.test(text))return'NF-e';
  if(/BILL OF LADING|SHIPPER|CONSIGNEE|CARRIER:/i.test(text)||/\bBL\b/i.test(name))return'BL';
  if(/\bDARE-SP\b|Documento de Arrecada[cç][aã]o de Receitas Estaduais/i.test(text))return'DARE';
  return'PDF';
}

async function identifyKind(bytes:ArrayBuffer,filename:string):Promise<Kind>{
  try{
    const pdf=await getDocument({data:new Uint8Array(bytes.slice(0))}).promise;
    let sample='';
    for(let n=1;n<=Math.min(2,pdf.numPages);n++){
      const page=await pdf.getPage(n);const content=await page.getTextContent();
      sample+=(content.items as PdfTextItem[]).map(i=>String(i.str||'')).join(' ')+'\n';
    }
    return classify(sample,filename);
  }catch{return'PDF'}
}

let cache:Promise<Candidate[]>|null=null;
async function candidates():Promise<Candidate[]>{
  if(cache)return cache;
  cache=(async()=>{
    const out:Candidate[]=[];
    const pdfInput=document.querySelector<HTMLInputElement>('[data-iguasport-file="pdfs"]');
    for(const file of [...(pdfInput?.files||[])]){
      const bytes=await file.arrayBuffer();out.push({kind:await identifyKind(bytes,file.name),filename:file.name,bytes});
    }
    const zipFile=document.querySelector<HTMLInputElement>('[data-iguasport-file="zip"]')?.files?.[0];
    if(zipFile){
      const zip=await JSZip.loadAsync(zipFile);
      const entries=Object.values(zip.files).filter(e=>!e.dir&&/\.pdf$/i.test(e.name));
      for(const entry of entries){const bytes=await entry.async('arraybuffer');out.push({kind:await identifyKind(bytes,entry.name),filename:entry.name,bytes})}
    }
    return out;
  })();
  return cache;
}
document.addEventListener('change',event=>{if(event.target instanceof HTMLInputElement&&event.target.matches('[data-iguasport-file]'))cache=null});

function parseSource(source:string){
  const m=source.match(/^(DUIMP|NF-e|BL|DARE|PDF)\s*·\s*(.*?)\s*·\s*página\s*(\d+)/i);
  return m?{kind:m[1] as Kind,filename:m[2].trim(),page:Number(m[3])}:null;
}

function rowData(row:HTMLElement){
  return{
    label:row.querySelector<HTMLElement>('.client-report-field b')?.textContent?.trim()||'',
    value:row.querySelector<HTMLElement>('.client-report-value')?.textContent?.trim()||'',
    source:row.querySelector<HTMLElement>('.client-report-source-detail > span')?.textContent?.trim()||row.querySelector<HTMLElement>('.client-report-field span')?.textContent?.trim()||''
  };
}

function preferredKinds(label:string,value:string):Kind[]{
  if(/^Cliente$/i.test(label))return['DUIMP','NF-e'];
  if(/Tipo Documento/i.test(label))return['DUIMP','DARE','BL','NF-e'];
  if(/Remetente|Exportador/i.test(label))return['DUIMP','BL'];
  if(/Nº\s*BL|AWB/i.test(label)||/Agência Marítima/i.test(label))return['BL'];
  if(/Local de Armazenagem|Ref\. do Cliente|Nº Documento/i.test(label))return['DUIMP','NF-e','DARE'];
  if(/Destinatário|Importador/i.test(label))return['DUIMP','BL','NF-e'];
  if(/Operação Marítima/i.test(label))return['DUIMP','BL'];
  if(/CNPJ do Cliente/i.test(label))return['DUIMP','NF-e'];
  if(/Cont[eê]ineres|Peso Líquido/i.test(label))return['DUIMP','NF-e','BL'];
  if(/Valor Total da Nota/i.test(label))return['NF-e'];
  return /DARE/i.test(value)?['DARE']:['DUIMP','NF-e','BL','DARE','PDF'];
}

function anchors(label:string){
  if(/^Cliente$/i.test(label))return['NOME DO IMPORTADOR','IGUASPORT LTDA'];
  if(/Tipo Documento/i.test(label))return['EXTRATO DA DUIMP','DARE-SP','BILL OF LADING','DANFE'];
  if(/Remetente|Exportador/i.test(label))return['CÓDIGO DO EXPORTADOR ESTRANGEIRO','SHIPPER'];
  if(/Nº\s*BL|AWB/i.test(label))return['BILL OF LADING NUMBER'];
  if(/Local de Armazenagem/i.test(label))return['LOCAL DE ARMAZENAMENTO','RECINTO'];
  if(/Ref\. do Cliente/i.test(label))return['REFERÊNCIA DO CLIENTE','REF. CLIENTE'];
  if(/Nº Documento/i.test(label))return['EXTRATO DA DUIMP','DUIMP'];
  if(/Destinatário|Importador/i.test(label))return['NOME DO IMPORTADOR','CONSIGNEE'];
  if(/Operação Marítima/i.test(label))return['PROCESSO DE IMPORTAÇÃO','EXTRATO DA DUIMP','BILL OF LADING'];
  if(/Agência Marítima/i.test(label))return['CARRIER','AGENTS FOR THE CARRIER','CMA CGM'];
  if(/CNPJ do Cliente/i.test(label))return['CNPJ DO IMPORTADOR','CNPJ'];
  if(/Cont[eê]ineres/i.test(label))return['CONTAINERS','CONTAINER AND SEALS'];
  if(/Peso Líquido/i.test(label))return['PESO LÍQUIDO TOTAL','PESO LÍQUIDO (KG)','PESO LÍQUIDO'];
  if(/Valor Total da Nota/i.test(label))return['VALOR TOTAL DA NOTA'];
  return[];
}

async function pageText(pdf:any,n:number){const p=await pdf.getPage(n),c=await p.getTextContent();return(c.items as PdfTextItem[]).map(i=>String(i.str||'')).join(' ')}

async function locate(row:HTMLElement):Promise<Array<{candidate:Candidate;page:number}>>{
  const {label,value,source}=rowData(row),all=await candidates();if(!all.length)return[];
  const parsed=parseSource(source);
  if(parsed){
    const wanted=parsed.filename.replace(/\\/g,'/').toLowerCase(),base=wanted.split('/').pop()||wanted;
    const exact=all.find(c=>{const n=c.filename.replace(/\\/g,'/').toLowerCase();return n===wanted||n.endsWith('/'+base)||n.split('/').pop()===base});
    if(exact)return[{candidate:exact,page:parsed.page}];
  }
  const kinds=preferredKinds(label,value),ordered=[...all].sort((a,b)=>kinds.indexOf(a.kind)-kinds.indexOf(b.kind));
  if(/Tipo Documento/i.test(label)){
    const wantedKinds:kindsType[]=[] as any;
  }
  const sought=[value,...anchors(label)].map(norm).filter(v=>v.length>=3);
  const hits:Array<{candidate:Candidate;page:number}>=[];
  for(const candidate of ordered){
    if(!kinds.includes(candidate.kind))continue;
    try{
      const pdf=await getDocument({data:new Uint8Array(candidate.bytes.slice(0))}).promise;
      for(let n=1;n<=pdf.numPages;n++){
        const text=norm(await pageText(pdf,n));
        const containerValues=/Cont[eê]ineres/i.test(label)?(value.match(/[A-Z]{4}[-\s]?\d{7}/gi)||[]).map(normalizeContainer):[];
        const matched=containerValues.length?containerValues.some(v=>text.includes(v)):sought.some(v=>text.includes(v));
        if(matched){hits.push({candidate,page:n});break}
      }
    }catch{}
  }
  if(/Tipo Documento/i.test(label)){
    const needed:Kind[]=[];if(/DUIMP/i.test(value))needed.push('DUIMP');if(/DARE/i.test(value))needed.push('DARE');if(/\bBL\b/i.test(value))needed.push('BL');if(/NF-?e/i.test(value))needed.push('NF-e');
    const multi:Array<{candidate:Candidate;page:number}>=[];
    for(const kind of needed){const found=hits.find(h=>h.candidate.kind===kind)||ordered.find(c=>c.kind===kind);if(found&&'candidate' in found)multi.push(found as any);else if(found)multi.push({candidate:found as Candidate,page:1})}
    if(multi.length)return multi;
  }
  if(/Cont[eê]ineres/i.test(label))return hits.slice(0,4);
  return hits.slice(0,1);
}

type kindsType=Kind;

function itemBox(item:PdfTextItem,viewport:any,scale:number):Box{
  const t=item.transform||[];const [vx,vy]=viewport.convertToViewportPoint(Number(t[4]||0),Number(t[5]||0));
  const w=Math.max(18,Number(item.width||0)*scale),h=Math.max(12,Number(item.height||9)*scale);return{x:vx,y:vy-h,w,h,cx:vx+w/2,cy:vy-h/2};
}
function drawBox(ctx:CanvasRenderingContext2D,canvas:HTMLCanvasElement,box:Box,pad=7){
  const x=Math.max(0,box.x-pad),y=Math.max(0,box.y-pad),w=Math.min(canvas.width-x,box.w+pad*2),h=Math.min(canvas.height-y,box.h+pad*2);
  ctx.save();ctx.strokeStyle='#c8102e';ctx.lineWidth=4;ctx.fillStyle='rgba(200,16,46,.14)';ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);ctx.restore();
}
function nearest(items:PdfTextItem[],viewport:any,scale:number,label:string,value:string){
  const usable=items.filter(i=>String(i.str||'').trim()&&i.transform),nv=norm(value),anchorTerms=anchors(label).map(norm);
  const valueMatches=usable.filter(i=>{const t=norm(String(i.str||''));return t&&nv&&(t===nv||(t.length>=4&&nv.includes(t))||(nv.length>=5&&t.includes(nv)))});
  if(valueMatches.length)return valueMatches.slice(0,3);
  const anchorItems=usable.filter(i=>anchorTerms.some(a=>{const t=norm(String(i.str||''));return t.includes(a)||a.includes(t)}));
  if(anchorItems.length)return anchorItems.slice(0,2);
  return[];
}

function ensureLightbox(){
  let modal=document.querySelector<HTMLElement>('.client-report-preview-modal');if(modal)return modal;
  modal=document.createElement('div');modal.className='client-report-preview-modal';modal.hidden=true;
  modal.innerHTML='<button type="button" class="client-report-preview-modal-close" aria-label="Fechar visualização">×</button><div class="client-report-preview-modal-body"><img alt="Visualização ampliada da fonte"></div>';
  document.body.appendChild(modal);const close=()=>{modal!.hidden=true};modal.addEventListener('click',e=>{if(e.target===modal)close()});modal.querySelector('.client-report-preview-modal-close')?.addEventListener('click',close);return modal;
}
function openModal(src:string,alt:string){const m=ensureLightbox(),img=m.querySelector<HTMLImageElement>('img');if(!img)return;img.src=src;img.alt=alt;m.hidden=false}

async function render(row:HTMLElement,hit:{candidate:Candidate;page:number},container:HTMLElement){
  const {label,value}=rowData(row),pdf=await getDocument({data:new Uint8Array(hit.candidate.bytes.slice(0))}).promise;
  if(hit.page<1||hit.page>pdf.numPages)return;
  const page=await pdf.getPage(hit.page),scale=1.35,viewport=page.getViewport({scale}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext('2d');if(!ctx)return;await page.render({canvas,canvasContext:ctx,viewport}).promise;
  let boxes:Box[]=[];
  try{const content=await page.getTextContent(),items=content.items as PdfTextItem[];boxes=nearest(items,viewport,scale,label,value).map(i=>itemBox(i,viewport,scale));
    if(/Cont[eê]ineres/i.test(label)){boxes=[];for(const c of value.match(/[A-Z]{4}[-\s]?\d{7}/gi)||[]){const nc=normalizeContainer(c),found=items.find(i=>{const t=normalizeContainer(String(i.str||''));return t===nc||t.includes(nc)||nc.includes(t)});if(found)boxes.push(itemBox(found,viewport,scale))}}
    boxes.forEach(b=>drawBox(ctx,canvas,b));
  }catch{}
  const wrap=document.createElement('div');wrap.className='client-report-source-preview-card';
  const caption=document.createElement('div');caption.className='client-report-source-preview-caption';caption.textContent=`Print do PDF · ${hit.candidate.filename} · página ${hit.page} · clique para ampliar`;
  const img=document.createElement('img');img.className='client-report-source-preview-image';img.alt=`Origem de ${label} em ${hit.candidate.filename}, página ${hit.page}`;img.src=canvas.toDataURL('image/png');img.tabIndex=0;img.setAttribute('role','button');img.addEventListener('click',()=>openModal(img.src,img.alt));img.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openModal(img.src,img.alt)}});
  if(!boxes.length){const note=document.createElement('div');note.className='client-report-preview-marker-note';note.textContent='Página localizada. O destaque vermelho indica a região quando o PDF fornece coordenadas de texto suficientes.';wrap.append(caption,note,img)}else wrap.append(caption,img);
  container.appendChild(wrap);
}

async function build(row:HTMLElement,preview:HTMLElement){
  if(preview.dataset.iguasportLoaded==='true'||preview.dataset.iguasportLoading==='true')return;
  preview.dataset.iguasportLoading='true';preview.innerHTML='<div class="client-report-preview-loading">Gerando print da fonte IGUASPORT...</div>';
  try{const hits=await locate(row);preview.replaceChildren();if(!hits.length)throw new Error('Não foi possível localizar visualmente a origem desta informação nos PDFs da IGUASPORT.');for(const hit of hits)await render(row,hit,preview);preview.dataset.iguasportLoaded='true'}
  catch(error){preview.innerHTML=`<div class="client-report-preview-unavailable">${esc(error instanceof Error?error.message:'Não foi possível gerar o print da fonte IGUASPORT.')}</div>`;preview.dataset.iguasportLoaded='true'}
  finally{delete preview.dataset.iguasportLoading}
}

document.addEventListener('click',event=>{
  const target=event.target;if(!(target instanceof Element))return;
  const toggle=target.closest<HTMLButtonElement>('.iguasport-report-view .client-report-source-toggle');if(!toggle)return;
  event.preventDefault();event.stopImmediatePropagation();
  const row=toggle.closest<HTMLElement>('.client-report-row'),detail=row?.querySelector<HTMLElement>('.client-report-source-detail'),preview=detail?.querySelector<HTMLElement>('.client-report-source-preview');if(!row||!detail||!preview)return;
  const open=toggle.getAttribute('aria-expanded')==='true';toggle.setAttribute('aria-expanded',String(!open));toggle.setAttribute('aria-label',open?'Mostrar fonte desta informação':'Ocultar fonte desta informação');detail.hidden=open;row.classList.toggle('source-open',!open);if(!open)void build(row,preview);
},true);
