import JSZip from 'jszip';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const esc=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]||char));
const norm=(value:string)=>value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');

const sourceInfo=(sourceText:string)=>{
  const match=sourceText.match(/^(DOC COMPLETO|NF FISCAL|ZIP PDF)\s*·\s*(.*?)\s*·\s*página\s*(\d+)/i);
  if(!match)return null;
  return{kind:match[1].toUpperCase(),filename:match[2].trim(),page:Number(match[3])};
};

async function sourcePdfBytes(sourceText:string):Promise<ArrayBuffer|null>{
  const info=sourceInfo(sourceText);
  if(!info)return null;
  if(info.kind==='DOC COMPLETO'){
    const file=document.querySelector<HTMLInputElement>('[data-client-file="doc"]')?.files?.[0];
    return file?file.arrayBuffer():null;
  }
  if(info.kind==='NF FISCAL'){
    const file=document.querySelector<HTMLInputElement>('[data-client-file="nf"]')?.files?.[0];
    return file?file.arrayBuffer():null;
  }
  const zipFile=document.querySelector<HTMLInputElement>('[data-client-file="zip"]')?.files?.[0];
  if(!zipFile)return null;
  const zip=await JSZip.loadAsync(zipFile);
  const wanted=info.filename.replace(/\\/g,'/').toLowerCase();
  const wantedBase=wanted.split('/').pop()||wanted;
  const entry=Object.values(zip.files).find(item=>{
    if(item.dir)return false;
    const name=item.name.replace(/\\/g,'/').toLowerCase();
    return name===wanted||name.endsWith('/'+wantedBase)||(name.split('/').pop()===wantedBase);
  });
  return entry?entry.async('arraybuffer'):null;
}

async function buildPdfPreview(row:HTMLElement,sourceText:string,container:HTMLElement){
  if(container.dataset.loaded==='true'||container.dataset.loading==='true')return;
  const info=sourceInfo(sourceText);
  if(!info){container.innerHTML='<div class="client-report-preview-unavailable">Prévia indisponível para esta fonte composta.</div>';container.dataset.loaded='true';return;}
  container.dataset.loading='true';
  container.innerHTML='<div class="client-report-preview-loading">Gerando print da fonte...</div>';
  try{
    const bytes=await sourcePdfBytes(sourceText);
    if(!bytes)throw new Error('Arquivo de origem não está mais disponível nesta análise.');
    const pdf=await getDocument({data:new Uint8Array(bytes)}).promise;
    if(info.page<1||info.page>pdf.numPages)throw new Error('Página da fonte não localizada no PDF.');
    const page=await pdf.getPage(info.page);
    const scale=1.35;
    const viewport=page.getViewport({scale});
    const canvas=document.createElement('canvas');
    canvas.width=Math.ceil(viewport.width);
    canvas.height=Math.ceil(viewport.height);
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Não foi possível criar a prévia.');
    await page.render({canvas,canvasContext:ctx,viewport}).promise;

    const value=row.querySelector<HTMLElement>('.client-report-value')?.textContent?.trim()||'';
    const needle=norm(value).slice(0,48);
    if(needle.length>=4){
      try{
        const content=await page.getTextContent();
        const item=(content.items as any[]).find(raw=>{
          const text=norm(String(raw?.str||''));
          return text.length>=4&&(text.includes(needle)||needle.includes(text));
        });
        if(item?.transform){
          const x=Number(item.transform[4]||0),y=Number(item.transform[5]||0);
          const [vx,vy]=viewport.convertToViewportPoint(x,y);
          const w=Math.max(50,Number(item.width||0)*scale);
          const h=Math.max(18,Number(item.height||10)*scale);
          ctx.save();
          ctx.strokeStyle='#c8102e';
          ctx.lineWidth=3;
          ctx.fillStyle='rgba(200,16,46,.10)';
          ctx.fillRect(Math.max(0,vx-8),Math.max(0,vy-h-8),Math.min(canvas.width-vx+8,w+16),h+16);
          ctx.strokeRect(Math.max(0,vx-8),Math.max(0,vy-h-8),Math.min(canvas.width-vx+8,w+16),h+16);
          ctx.restore();
        }
      }catch{}
    }

    const img=document.createElement('img');
    img.className='client-report-source-preview-image';
    img.alt=`Print da fonte em ${info.filename}, página ${info.page}`;
    img.src=canvas.toDataURL('image/png');
    const caption=document.createElement('div');
    caption.className='client-report-source-preview-caption';
    caption.textContent=`Print do PDF · ${info.filename} · página ${info.page}`;
    container.replaceChildren(caption,img);
    container.dataset.loaded='true';
  }catch(error){
    container.innerHTML=`<div class="client-report-preview-unavailable">${esc(error instanceof Error?error.message:'Não foi possível gerar o print da fonte.')}</div>`;
    container.dataset.loaded='true';
  }finally{
    delete container.dataset.loading;
  }
}

const enhanceReportSources = (root: ParentNode = document) => {
  root.querySelectorAll<HTMLElement>('.client-report-row').forEach((row, index) => {
    if (row.dataset.sourceEnhanced === 'true') return;

    const field = row.querySelector<HTMLElement>('.client-report-field');
    const source = field?.querySelector<HTMLElement>('span');
    const confidence = row.querySelector<HTMLElement>('.client-report-confidence');
    if (!field || !source || !confidence) return;

    const sourceText = source.textContent?.trim() || 'Fonte não informada.';
    source.remove();

    const statusText = document.createElement('span');
    statusText.className = 'client-report-confidence-text';
    while (confidence.firstChild) statusText.appendChild(confidence.firstChild);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'client-report-source-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Mostrar fonte desta informação');
    toggle.innerHTML = '<span aria-hidden="true">⌄</span>';

    const detail = document.createElement('div');
    detail.className = 'client-report-source-detail';
    detail.id = `client-report-source-${Date.now()}-${index}`;
    detail.hidden = true;
    detail.innerHTML = `<b>Fonte da informação</b><span>${esc(sourceText)}</span><div class="client-report-source-preview"></div>`;
    const preview=detail.querySelector<HTMLElement>('.client-report-source-preview')!;

    toggle.setAttribute('aria-controls', detail.id);
    confidence.appendChild(statusText);
    confidence.appendChild(toggle);
    row.appendChild(detail);

    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.setAttribute('aria-label', open ? 'Mostrar fonte desta informação' : 'Ocultar fonte desta informação');
      detail.hidden = open;
      row.classList.toggle('source-open', !open);
      if(!open)void buildPdfPreview(row,sourceText,preview);
    });

    row.dataset.sourceEnhanced = 'true';
  });
};

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches('.client-report-row') || node.querySelector('.client-report-row')) {
        enhanceReportSources(node.matches('.client-report-row') ? node.parentNode || document : node);
      }
    }
  }
});

const start = () => {
  enhanceReportSources();
  observer.observe(document.documentElement, { childList: true, subtree: true });
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
