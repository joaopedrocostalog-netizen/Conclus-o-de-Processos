import JSZip from 'jszip';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();

export {};

type PdfCandidate={filename:string;bytes:ArrayBuffer};
type PdfTextItem={str?:string;transform?:number[];width?:number;height?:number};
type Box={x:number;y:number;w:number;h:number};
type Positioned={item:PdfTextItem;x:number;y:number;text:string;digits:string};

const onlyDigits=(value:string)=>value.replace(/\D/g,'');
const text=(item:PdfTextItem)=>String(item.str||'').trim();
let pdfCache:Promise<PdfCandidate[]>|null=null;

document.addEventListener('change',event=>{
  if(event.target instanceof HTMLInputElement&&event.target.matches('[data-xcmg-file]'))pdfCache=null;
});

async function pdfCandidates():Promise<PdfCandidate[]>{
  if(pdfCache)return pdfCache;
  pdfCache=(async()=>{
    const out:PdfCandidate[]=[];
    const nfs=Array.from(document.querySelector<HTMLInputElement>('[data-xcmg-file="nf"]')?.files||[]);
    for(const nf of nfs)out.push({filename:nf.name,bytes:await nf.arrayBuffer()});
    const zipFile=document.querySelector<HTMLInputElement>('[data-xcmg-file="zip"]')?.files?.[0];
    if(zipFile){
      const zip=await JSZip.loadAsync(await zipFile.arrayBuffer());
      for(const entry of Object.values(zip.files).filter(entry=>!entry.dir&&/\.pdf$/i.test(entry.name))){
        out.push({filename:entry.name,bytes:await entry.async('arraybuffer')});
      }
    }
    return out;
  })();
  return pdfCache;
}

function sameFile(a:string,b:string){
  const aa=a.replace(/\\/g,'/').toLowerCase(),bb=b.replace(/\\/g,'/').toLowerCase();
  return aa===bb||aa.split('/').pop()===bb.split('/').pop();
}

function parseSource(source:string){
  const m=source.match(/^NF\s*·\s*(.*?)\s*·\s*página\s*(\d+)/i);
  return m?{filename:m[1].trim(),page:Number(m[2])}:null;
}

function positioned(items:PdfTextItem[]):Positioned[]{
  return items.filter(item=>text(item)&&item.transform).map(item=>({
    item,
    x:Number(item.transform?.[4]||0),
    y:Number(item.transform?.[5]||0),
    text:text(item),
    digits:onlyDigits(text(item))
  }));
}

function lineGroups(cells:Positioned[]){
  const groups:Array<{y:number;cells:Positioned[]}>=[];
  for(const cell of cells){
    let group=groups.find(candidate=>Math.abs(candidate.y-cell.y)<=2.8);
    if(!group){group={y:cell.y,cells:[]};groups.push(group)}
    group.cells.push(cell);
  }
  return groups.map(group=>{
    const sorted=[...group.cells].sort((a,b)=>a.x-b.x);
    return{y:group.y,cells:sorted,text:sorted.map(c=>c.text).join(' ').replace(/\s+/g,' ').trim(),digits:sorted.map(c=>c.digits).join('')};
  });
}

function itemBox(item:PdfTextItem,viewport:any,scale:number):Box{
  const t=item.transform||[];
  const [x,y]=viewport.convertToViewportPoint(Number(t[4]||0),Number(t[5]||0));
  const h=Math.max(12,Number(item.height||9)*scale);
  return{x,y:y-h,w:Math.max(18,Number(item.width||0)*scale),h};
}

function mergeBoxes(boxes:Box[]):Box{
  const x=Math.min(...boxes.map(box=>box.x));
  const y=Math.min(...boxes.map(box=>box.y));
  const right=Math.max(...boxes.map(box=>box.x+box.w));
  const bottom=Math.max(...boxes.map(box=>box.y+box.h));
  return{x,y,w:right-x,h:bottom-y};
}

function drawBox(ctx:CanvasRenderingContext2D,box:Box){
  const pad=7;
  ctx.save();
  ctx.strokeStyle='#c8102e';ctx.lineWidth=4;ctx.fillStyle='rgba(200,16,46,.12)';
  ctx.fillRect(box.x-pad,box.y-pad,box.w+pad*2,box.h+pad*2);
  ctx.strokeRect(box.x-pad,box.y-pad,box.w+pad*2,box.h+pad*2);
  ctx.restore();
}

function crop(canvas:HTMLCanvasElement,boxes:Box[]){
  const merged=mergeBoxes(boxes),px=55,py=34;
  const sx=Math.max(0,Math.floor(merged.x-px)),sy=Math.max(0,Math.floor(merged.y-py));
  const sw=Math.min(canvas.width-sx,Math.ceil(merged.w+px*2)),sh=Math.min(canvas.height-sy,Math.ceil(merged.h+py*2));
  const out=document.createElement('canvas');out.width=Math.max(1,sw);out.height=Math.max(1,sh);
  out.getContext('2d')?.drawImage(canvas,sx,sy,sw,sh,0,0,sw,sh);return out;
}

function ensureLightbox(){
  let modal=document.querySelector<HTMLElement>('.client-report-preview-modal');if(modal)return modal;
  modal=document.createElement('div');modal.className='client-report-preview-modal';modal.hidden=true;
  modal.innerHTML='<button type="button" class="client-report-preview-modal-close" aria-label="Fechar visualização">×</button><div class="client-report-preview-modal-body"><img alt="Visualização ampliada da fonte"></div>';
  document.body.appendChild(modal);const close=()=>{if(modal)modal.hidden=true};
  modal.addEventListener('click',event=>{if(event.target===modal)close()});modal.querySelector('.client-report-preview-modal-close')?.addEventListener('click',close);return modal;
}
function openPreview(src:string,alt:string){const modal=ensureLightbox(),img=modal.querySelector<HTMLImageElement>('img');if(!img)return;img.src=src;img.alt=alt;modal.hidden=false}

async function build(row:HTMLElement,preview:HTMLElement){
  preview.innerHTML='<div class="client-report-preview-loading">Gerando print exato do CNPJ...</div>';
  try{
    const value=row.querySelector<HTMLElement>('.client-report-value')?.textContent?.trim()||'';
    const wanted=onlyDigits(value);if(wanted.length!==14)throw new Error('O CNPJ do relatório não possui 14 dígitos.');
    const source=row.querySelector<HTMLElement>('.client-report-source-detail > span')?.textContent?.trim()||'';
    const parsed=parseSource(source);if(!parsed)throw new Error('A fonte da NF não pôde ser identificada.');
    const candidate=(await pdfCandidates()).find(item=>sameFile(item.filename,parsed.filename));if(!candidate)throw new Error('O PDF usado como fonte não está mais disponível.');
    const pdf=await getDocument({data:new Uint8Array(candidate.bytes.slice(0))}).promise;
    const page=await pdf.getPage(parsed.page),scale=1.9,viewport=page.getViewport({scale});
    const content=await page.getTextContent(),cells=positioned(content.items as PdfTextItem[]),groups=lineGroups(cells);

    // O bloco correto é o CNPJ no cabeçalho do DANFE, imediatamente antes de DESTINATÁRIO / REMETENTE.
    const recipient=groups.find(group=>/DESTINAT[ÁA]RIO\s*\/\s*REMETENTE/i.test(group.text));
    const candidateLabels=cells.filter(cell=>cell.text.trim().toUpperCase()==='CNPJ'&&(!recipient||cell.y>recipient.y));
    if(!candidateLabels.length)throw new Error('O rótulo CNPJ do cabeçalho não foi localizado.');

    let best:{label:Positioned;valueCells:Positioned[];score:number}|null=null;
    for(const label of candidateLabels){
      // Procura apenas na faixa logo abaixo do rótulo e na mesma coluna visual.
      const nearby=cells.filter(cell=>{
        const dy=label.y-cell.y;
        return dy>=0&&dy<=38&&cell.x>=label.x-8&&cell.x<=label.x+260;
      });
      const nearbyGroups=lineGroups(nearby);
      for(const group of nearbyGroups){
        const digits=group.digits;
        if(digits.length!==14||digits!==wanted)continue;
        const valueCells=group.cells.filter(cell=>cell.digits||/[./-]/.test(cell.text));
        if(!valueCells.length)continue;
        const dx=Math.abs((valueCells[0]?.x||0)-label.x),dy=label.y-group.y;
        const score=dy*10+dx;
        if(!best||score<best.score)best={label,valueCells,score};
      }
    }
    if(!best)throw new Error('O CNPJ exato não foi localizado dentro do bloco CNPJ do cabeçalho da NF.');

    const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Não foi possível gerar o print.');
    await page.render({canvas,canvasContext:ctx,viewport}).promise;
    const labelBox=itemBox(best.label.item,viewport,scale),valueBox=mergeBoxes(best.valueCells.map(cell=>itemBox(cell.item,viewport,scale)));
    const blockBox=mergeBoxes([labelBox,valueBox]);drawBox(ctx,blockBox);
    const output=crop(canvas,[blockBox]);

    const wrap=document.createElement('div');wrap.className='client-report-source-preview-card';
    const caption=document.createElement('div');caption.className='client-report-source-preview-caption';caption.textContent=`Print da NF · ${parsed.filename} · página ${parsed.page} · bloco CNPJ do Cliente / Importador · clique para ampliar`;
    const img=document.createElement('img');img.className='client-report-source-preview-image';img.src=output.toDataURL('image/png');img.alt='Bloco CNPJ do Cliente / Importador na NF';img.tabIndex=0;img.setAttribute('role','button');
    img.addEventListener('click',()=>openPreview(img.src,img.alt));img.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openPreview(img.src,img.alt)}});
    wrap.append(caption,img);preview.replaceChildren(wrap);preview.dataset.xcmgCnpjExact='true';
  }catch(error){preview.innerHTML=`<div class="client-report-preview-unavailable">${error instanceof Error?error.message:'Não foi possível gerar o print exato do CNPJ.'}</div>`}
}

// Usa window em capture para garantir prioridade sobre qualquer preview genérico.
window.addEventListener('click',event=>{
  const target=event.target instanceof Element?event.target.closest<HTMLButtonElement>('.xcmg-report-view .client-report-source-toggle'):null;if(!target)return;
  const row=target.closest<HTMLElement>('.client-report-row');const label=row?.querySelector<HTMLElement>('.client-report-field b')?.textContent?.trim()||'';
  if(!row||!/^CNPJ do Cliente \/ Importador$/i.test(label))return;
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
  const detail=row.querySelector<HTMLElement>('.client-report-source-detail'),preview=detail?.querySelector<HTMLElement>('.client-report-source-preview');if(!detail||!preview)return;
  const open=target.getAttribute('aria-expanded')==='true';target.setAttribute('aria-expanded',String(!open));detail.hidden=open;row.classList.toggle('source-open',!open);
  if(!open)void build(row,preview);
},true);
