import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();
export {};

type PdfCandidate={filename:string;bytes:ArrayBuffer};
type PdfTextItem={str?:string;transform?:number[];width?:number;height?:number};
type Box={x:number;y:number;w:number;h:number};
type TextLine={items:PdfTextItem[];text:string;normalized:string};

const norm=(v:string)=>v.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');
const txt=(item:PdfTextItem)=>String(item.str||'').trim();
const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
let cache:Promise<PdfCandidate[]>|null=null;
document.addEventListener('change',e=>{if(e.target instanceof HTMLInputElement&&e.target.matches('[data-kemin-file="pdfs"]'))cache=null});

async function candidates(){
  if(cache)return cache;
  cache=(async()=>{const out:PdfCandidate[]=[];for(const file of Array.from(document.querySelector<HTMLInputElement>('[data-kemin-file="pdfs"]')?.files||[]))out.push({filename:file.name,bytes:await file.arrayBuffer()});return out})();
  return cache;
}
function sameFile(a:string,b:string){const aa=a.replace(/\\/g,'/').toLowerCase(),bb=b.replace(/\\/g,'/').toLowerCase();return aa===bb||aa.split('/').pop()===bb.split('/').pop()}
function parsePdfSource(source:string){const m=source.match(/^PDF\s*·\s*(.*?)\s*·\s*página\s*(\d+)\s*·\s*(.*)$/i);return m?{filename:m[1].trim(),page:Number(m[2]),note:m[3].trim()}:null}
function parseAggregate(source:string){
  if(!/^Soma de\s+\d+\s+NFs\s*·/i.test(source))return null;
  const body=source.replace(/^Soma de\s+\d+\s+NFs\s*·\s*/i,''),parts:Array<{filename:string;page:number;value:string}>=[];
  const re=/(?:^|\s\+\s)(.*?)\s*·\s*página\s*(\d+)\s*·\s*(?:R\$\s*)?([\d.]+,\d{2,3})(?=\s\+\s|$)/gi;
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
  return groups.sort((a,b)=>b.y-a.y).map(g=>{const cells=g.cells.sort((a,b)=>a.x-b.x),text=cells.map(c=>txt(c.item)).join(' ').replace(/\s+/g,' ').trim();return{items:cells.map(c=>c.item),text,normalized:norm(text)}}).filter(l=>l.text)
}
function select(items:PdfTextItem[],value:string,label:string){
  const ls=lines(items),nv=norm(value);
  let target=ls.find(l=>nv&&l.normalized.includes(nv));
  const anchors:string[]=[];
  if(/Peso Líquido/i.test(label))anchors.push('PESO LIQUIDO','PESO LÍQUIDO');
  else if(/Valor Total da Nota/i.test(label))anchors.push('VALOR TOTAL DA NOTA');
  else if(/Ref\. do Cliente/i.test(label))anchors.push('N/REF','REF CLIENTE','PED CLIENTE');
  else if(/Nº Documento/i.test(label))anchors.push('DUIMP');
  else if(/CNPJ/i.test(label))anchors.push('CNPJ');
  else if(/Remetente|Exportador/i.test(label))anchors.push('DESTINATARIO REMETENTE','SHIPPER');
  else if(/Destinatário|Importador/i.test(label))anchors.push('NOME RAZAO SOCIAL','CONSIGNEE');
  else if(/Local de Armazenagem/i.test(label))anchors.push('RECINTO ALFANDEGADO','LOCAL DE ARMAZENAGEM','RECINTO ADUANEIRO');
  else if(/Agência Marítima/i.test(label))anchors.push('CARRIER','AGENCIA MARITIMA','SHIPPING AGENT');
  else if(/Tipo Documento/i.test(label))anchors.push('DUIMP');
  else if(/Operação Marítima/i.test(label))anchors.push('IMPORTACAO','DUIMP');
  const anchorLines=ls.filter(l=>anchors.some(a=>l.normalized.includes(norm(a))));
  if(!target&&/Peso Líquido/i.test(label)){
    const marker=ls.findIndex(l=>l.normalized.includes('PESOLIQUIDO'));if(marker>=0)target=ls.slice(marker,marker+7).find(l=>l.text.includes(value));
  }
  if(!target&&/Valor Total da Nota/i.test(label)){
    const marker=ls.findIndex(l=>l.normalized.includes('VALORTOTALDANOTA'));if(marker>=0)target=ls.slice(marker,marker+6).find(l=>l.text.includes(value));
  }
  return{target,context:[...anchorLines.slice(0,2),...(target?[target]:[])]};
}
function crop(canvas:HTMLCanvasElement,boxes:Box[]){if(!boxes.length)return canvas;const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y)),r=Math.max(...boxes.map(b=>b.x+b.w)),bottom=Math.max(...boxes.map(b=>b.y+b.h)),px=80,py=50,sx=Math.max(0,Math.floor(x-px)),sy=Math.max(0,Math.floor(y-py)),sw=Math.min(canvas.width-sx,Math.ceil(r-x+px*2)),sh=Math.min(canvas.height-sy,Math.ceil(bottom-y+py*2));const out=document.createElement('canvas');out.width=Math.max(1,sw);out.height=Math.max(1,sh);out.getContext('2d')?.drawImage(canvas,sx,sy,sw,sh,0,0,sw,sh);return out}
function ensureLightbox(){let modal=document.querySelector<HTMLElement>('.client-report-preview-modal');if(modal)return modal;modal=document.createElement('div');modal.className='client-report-preview-modal';modal.hidden=true;modal.innerHTML='<button type="button" class="client-report-preview-modal-close" aria-label="Fechar visualização">×</button><div class="client-report-preview-modal-body"><img alt="Visualização ampliada da fonte"></div>';document.body.appendChild(modal);const close=()=>{if(modal)modal.hidden=true};modal.addEventListener('click',e=>{if(e.target===modal)close()});modal.querySelector('.client-report-preview-modal-close')?.addEventListener('click',close);return modal}
function openPreview(src:string,alt:string){const modal=ensureLightbox(),img=modal.querySelector<HTMLImageElement>('img');if(img){img.src=src;img.alt=alt;modal.hidden=false}}

async function renderPdf(row:HTMLElement,parsed:{filename:string;page:number;note:string},container:HTMLElement,override?:{label:string;value:string}){
  const candidate=(await candidates()).find(c=>sameFile(c.filename,parsed.filename));if(!candidate)throw new Error('O PDF usado como fonte não está mais selecionado.');
  const pdf=await getDocument({data:new Uint8Array(candidate.bytes.slice(0))}).promise;if(parsed.page<1||parsed.page>pdf.numPages)throw new Error('Página da fonte não localizada.');
  const page=await pdf.getPage(parsed.page),scale=1.9,viewport=page.getViewport({scale}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Não foi possível gerar o print.');
  await page.render({canvas,canvasContext:ctx,viewport}).promise;
  const content=await page.getTextContent(),items=content.items as PdfTextItem[],base=rowData(row),label=override?.label||base.label,value=override?.value||base.value,selection=select(items,value,label);
  const target=selection.target?merge(selection.target.items.map(i=>itemBox(i,viewport,scale))):null;if(target)draw(ctx,target);
  const boxes=[...(target?[target]:[]),...selection.context.flatMap(l=>l.items.map(i=>itemBox(i,viewport,scale)))],output=crop(canvas,boxes);
  const wrap=document.createElement('div');wrap.className='client-report-source-preview-card';const cap=document.createElement('div');cap.className='client-report-source-preview-caption';cap.textContent=`Print do PDF · ${parsed.filename} · página ${parsed.page} · ${parsed.note} · clique para ampliar`;const img=document.createElement('img');img.className='client-report-source-preview-image';img.src=output.toDataURL('image/png');img.alt=`Fonte de ${label}`;img.tabIndex=0;img.setAttribute('role','button');img.addEventListener('click',()=>openPreview(img.src,img.alt));wrap.append(cap,img);if(!target){const note=document.createElement('div');note.className='client-report-preview-marker-note';note.textContent='A fonte foi identificada no documento, mas o PDF não separou o valor em um bloco textual exato para o retângulo.';wrap.append(note)}container.appendChild(wrap)
}

async function renderAggregate(row:HTMLElement,parts:Array<{filename:string;page:number;value:string}>,container:HTMLElement){
  const {label,value:total}=rowData(row),summary=document.createElement('div');summary.className='client-report-source-preview-card';const cap=document.createElement('div');cap.className='client-report-source-preview-caption';cap.textContent=label==='Peso Líquido'?'Cálculo do Peso Líquido total':'Cálculo do Valor Total das Notas';const calc=document.createElement('div');calc.style.padding='12px 14px';calc.style.fontWeight='800';calc.style.fontSize='13px';calc.style.lineHeight='1.5';calc.textContent=`${parts.map(p=>label==='Valor Total da Nota'?`R$ ${p.value}`:p.value).join(' + ')} = ${label==='Valor Total da Nota'?'R$ ':''}${total}`;summary.append(cap,calc);container.appendChild(summary);
  for(const part of parts)await renderPdf(row,{filename:part.filename,page:part.page,note:label==='Peso Líquido'?'PESO LÍQUIDO':'VALOR TOTAL DA NOTA'},container,{label,value:part.value});
}

async function build(row:HTMLElement,source:string,container:HTMLElement){
  if(container.dataset.loading==='true'||container.dataset.loaded==='true')return;container.dataset.loading='true';container.innerHTML='<div class="client-report-preview-loading">Gerando prints das fontes...</div>';
  try{container.replaceChildren();const aggregate=parseAggregate(source),pdf=parsePdfSource(source);if(aggregate)await renderAggregate(row,aggregate,container);else if(pdf)await renderPdf(row,pdf,container);else container.innerHTML='<div class="client-report-preview-unavailable">Não existe uma fonte PDF localizada para este campo.</div>';container.dataset.loaded='true'}catch(error){container.innerHTML=`<div class="client-report-preview-unavailable">${esc(error instanceof Error?error.message:'Não foi possível gerar o print da fonte.')}</div>`;container.dataset.loaded='true'}finally{delete container.dataset.loading}
}

function enhance(){
  document.querySelectorAll<HTMLElement>('.kemin-report-view .client-report-row').forEach((row,index)=>{
    if(row.dataset.keminSourceEnhanced==='true')return;const field=row.querySelector<HTMLElement>('.client-report-field'),confidence=row.querySelector<HTMLElement>('.client-report-confidence');if(!field||!confidence)return;
    const source=field.querySelector<HTMLElement>('span')?.textContent?.trim()||'Fonte não informada.';field.querySelector('span')?.remove();const old=(confidence.textContent||'').trim();confidence.replaceChildren();const status=document.createElement('span');status.className='client-report-confidence-text';status.textContent=old;const toggle=document.createElement('button');toggle.type='button';toggle.className='client-report-source-toggle';toggle.setAttribute('aria-expanded','false');toggle.innerHTML='<span aria-hidden="true">⌄</span>';const detail=document.createElement('div');detail.className='client-report-source-detail';detail.id=`kemin-report-source-${Date.now()}-${index}`;detail.hidden=true;detail.innerHTML=`<b>Fonte da informação</b><span>${esc(source)}</span><div class="client-report-source-preview"></div>`;toggle.setAttribute('aria-controls',detail.id);confidence.append(status,toggle);row.appendChild(detail);const preview=detail.querySelector<HTMLElement>('.client-report-source-preview')!;toggle.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const open=toggle.getAttribute('aria-expanded')==='true';toggle.setAttribute('aria-expanded',String(!open));detail.hidden=open;row.classList.toggle('source-open',!open);if(!open)void build(row,source,preview)});row.dataset.keminSourceEnhanced='true';
  })
}
const observer=new MutationObserver(()=>enhance());const start=()=>{enhance();observer.observe(document.documentElement,{childList:true,subtree:true})};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
