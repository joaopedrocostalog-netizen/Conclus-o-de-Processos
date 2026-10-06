import JSZip from 'jszip';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { readXcmgSpreadsheet } from './clients/xcmg-spreadsheet';

GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();
export {};

type PdfCandidate={filename:string;bytes:ArrayBuffer};
type PdfTextItem={str?:string;transform?:number[];width?:number;height?:number};
type Box={x:number;y:number;w:number;h:number};
type TextLine={items:PdfTextItem[];y:number;text:string;normalized:string};
const norm=(v:string)=>v.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');
const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]||c));
let pdfCache:Promise<PdfCandidate[]>|null=null,sheetCache:ReturnType<typeof readXcmgSpreadsheet>|null=null;
function resetCaches(){pdfCache=null;sheetCache=null}
document.addEventListener('change',e=>{if(e.target instanceof HTMLInputElement&&e.target.matches('[data-xcmg-file]'))resetCaches()});

async function pdfCandidates(){
  if(pdfCache)return pdfCache;
  pdfCache=(async()=>{const out:PdfCandidate[]=[];const nf=document.querySelector<HTMLInputElement>('[data-xcmg-file="nf"]')?.files?.[0];if(nf)out.push({filename:nf.name,bytes:await nf.arrayBuffer()});const z=document.querySelector<HTMLInputElement>('[data-xcmg-file="zip"]')?.files?.[0];if(z){const zip=await JSZip.loadAsync(await z.arrayBuffer());for(const entry of Object.values(zip.files).filter(x=>!x.dir&&/\.pdf$/i.test(x.name)))out.push({filename:entry.name,bytes:await entry.async('arraybuffer')})}return out})();return pdfCache;
}
async function spreadsheet(){if(sheetCache)return sheetCache;const f=document.querySelector<HTMLInputElement>('[data-xcmg-file="sheet"]')?.files?.[0];if(!f)throw new Error('A planilha da XCMG não está mais selecionada.');sheetCache=readXcmgSpreadsheet(f);return sheetCache}
function rowData(row:HTMLElement){return{label:row.querySelector<HTMLElement>('.client-report-field b')?.textContent?.trim()||'',value:row.querySelector<HTMLElement>('.client-report-value')?.textContent?.trim()||'',source:row.querySelector<HTMLElement>('.client-report-source-detail > span')?.textContent?.trim()||row.querySelector<HTMLElement>('.client-report-field span')?.textContent?.trim()||''}}
function parsePdfSource(s:string){const m=s.match(/^NF\s*·\s*(.*?)\s*·\s*página\s*(\d+)\s*·\s*(.*)$/i);return m?{filename:m[1].trim(),page:Number(m[2]),note:m[3].trim()}:null}
function parseExcelSource(s:string){const m=s.match(/^Excel\s*·\s*(.*?)\s*·\s*aba\s*(.*?)\s*·\s*([^·]+?)\s*·\s*(.*)$/i);return m?{filename:m[1].trim(),sheet:m[2].trim(),cells:m[3].trim(),note:m[4].trim()}:null}
function sameFile(a:string,b:string){const aa=a.replace(/\\/g,'/').toLowerCase(),bb=b.replace(/\\/g,'/').toLowerCase();return aa===bb||aa.split('/').pop()===bb.split('/').pop()}

function ensureLightbox(){let modal=document.querySelector<HTMLElement>('.client-report-preview-modal');if(modal)return modal;modal=document.createElement('div');modal.className='client-report-preview-modal';modal.hidden=true;modal.innerHTML='<button type="button" class="client-report-preview-modal-close" aria-label="Fechar visualização">×</button><div class="client-report-preview-modal-body"><img alt="Visualização ampliada da fonte"></div>';document.body.appendChild(modal);const close=()=>{if(modal)modal.hidden=true};modal.addEventListener('click',e=>{if(e.target===modal)close()});modal.querySelector('.client-report-preview-modal-close')?.addEventListener('click',close);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal&&!modal.hidden)close()});return modal}
function openPreview(src:string,alt:string){const m=ensureLightbox(),img=m.querySelector<HTMLImageElement>('img');if(img){img.src=src;img.alt=alt;m.hidden=false}}
function itemBox(item:PdfTextItem,viewport:any,scale:number):Box{const t=item.transform||[],p=viewport.convertToViewportPoint(Number(t[4]||0),Number(t[5]||0)),h=Math.max(12,Number(item.height||9)*scale);return{x:p[0],y:p[1]-h,w:Math.max(18,Number(item.width||0)*scale),h}}
function mergeBoxes(boxes:Box[]):Box|null{if(!boxes.length)return null;const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y)),right=Math.max(...boxes.map(b=>b.x+b.w)),bottom=Math.max(...boxes.map(b=>b.y+b.h));return{x,y,w:right-x,h:bottom-y}}
function drawBox(ctx:CanvasRenderingContext2D,canvas:HTMLCanvasElement,b:Box){const p=7,x=Math.max(0,b.x-p),y=Math.max(0,b.y-p),w=Math.min(canvas.width-x,b.w+p*2),h=Math.min(canvas.height-y,b.h+p*2);ctx.save();ctx.strokeStyle='#c8102e';ctx.lineWidth=4;ctx.fillStyle='rgba(200,16,46,.12)';ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);ctx.restore()}
const txt=(i:PdfTextItem)=>String(i.str||'').trim();
function findValue(items:PdfTextItem[],value:string){const nv=norm(value),u=items.filter(i=>txt(i)&&i.transform);let m=u.filter(i=>{const t=norm(txt(i));return nv&&t&&(t===nv||(t.length>=5&&nv.length>=5&&(t.includes(nv)||nv.includes(t))))});if(m.length)return m;const tokens=value.split(/\s+/).map(norm).filter(t=>t.length>=5);return u.filter(i=>{const t=norm(txt(i));return tokens.some(k=>t===k||(t.length>=5&&(t.includes(k)||k.includes(t))))})}
function findAnchors(items:PdfTextItem[],terms:string[]){const a=terms.map(norm);return items.filter(i=>{const t=norm(txt(i));return t&&a.some(k=>t===k||t.includes(k)||k.includes(t))})}
function nearest(matches:PdfTextItem[],anchors:PdfTextItem[],viewport:any,scale:number,mode:'below'|'right'|'near'){if(!matches.length)return[];if(!anchors.length)return matches.slice(0,1);return matches.map(item=>{const b=itemBox(item,viewport,scale),bc={x:b.x+b.w/2,y:b.y+b.h/2};let s=Infinity;for(const a of anchors){const ab=itemBox(a,viewport,scale),ac={x:ab.x+ab.w/2,y:ab.y+ab.h/2},dx=bc.x-ac.x,dy=bc.y-ac.y;let q=Math.abs(dx)+Math.abs(dy)*2;if(mode==='below'&&dy< -8)q+=1800;if(mode==='right'&&dx< -8)q+=1800;if(Math.abs(dy)>180)q+=1200;s=Math.min(s,q)}return{item,s}}).sort((a,b)=>a.s-b.s).slice(0,1).map(x=>x.item)}
function anchorTerms(label:string){
  if(/^Cliente$/i.test(label)||/Destinatário|Importador/i.test(label))return['XCMG BRASIL INDUSTRIA LTDA'];
  if(/Remetente|Exportador/i.test(label))return['DESTINATÁRIO / REMETENTE','DESTINATARIO / REMETENTE','NOME/RAZÃO SOCIAL'];
  if(/Local de Armazenagem/i.test(label))return['RECINTO ALFANDEGADO'];
  if(/Ref\. do Cliente/i.test(label))return['REF. CLIENTE','REF CLIENTE'];
  if(/Nº Documento/i.test(label))return['NÚMERO DA DECLARAÇÃO','NUMERO DA DECLARACAO'];
  if(/CNPJ do Cliente/i.test(label))return['CNPJ'];
  if(/Peso Líquido/i.test(label))return['PESO LÍQUIDO','PESO LIQUIDO'];
  if(/Valor Total da Nota/i.test(label))return['VALOR TOTAL DA NOTA'];
  return[];
}
function textLines(items:PdfTextItem[]):TextLine[]{
  const usable=items.filter(i=>txt(i)&&i.transform).map(i=>({item:i,y:Number(i.transform?.[5]||0),x:Number(i.transform?.[4]||0)}));
  const groups:Array<{y:number;cells:typeof usable}>=[];
  for(const cell of usable){let g=groups.find(group=>Math.abs(group.y-cell.y)<=2.8);if(!g){g={y:cell.y,cells:[]};groups.push(g)}g.cells.push(cell)}
  return groups.sort((a,b)=>b.y-a.y).map(g=>{const sorted=g.cells.sort((a,b)=>a.x-b.x),lineItems=sorted.map(c=>c.item),text=sorted.map(c=>txt(c.item)).join(' ').replace(/\s+/g,' ').trim();return{items:lineItems,y:g.y,text,normalized:norm(text)}}).filter(l=>l.text);
}
function lineHasValue(line:TextLine,value:string){const nv=norm(value);if(!nv)return false;if(line.normalized.includes(nv)||nv.includes(line.normalized))return true;const tokens=value.split(/\s+/).map(norm).filter(t=>t.length>=4);return tokens.length>=2&&tokens.filter(t=>line.normalized.includes(t)).length>=Math.min(2,tokens.length)}
function strictLineIndexes(lines:TextLine[],value:string){const nv=norm(value);if(!nv)return[];return lines.map((line,index)=>line.normalized.includes(nv)?index:-1).filter(index=>index>=0)}
function findLineByTerms(lines:TextLine[],terms:string[]){const wanted=terms.map(norm);return lines.findIndex(line=>wanted.some(t=>t&&line.normalized.includes(t)))}
function headerContext(lines:TextLine[],index:number){const start=Math.max(0,index-1),end=Math.min(lines.length-1,index+4);return lines.slice(start,end+1)}
function exactFieldSelection(items:PdfTextItem[],value:string,label:string){
  const lines=textLines(items),strictIndexes=strictLineIndexes(lines,value),valueLineIndexes=lines.map((line,index)=>lineHasValue(line,value)?index:-1).filter(index=>index>=0);
  if(/^Cliente$/i.test(label)||/Destinatário|Importador/i.test(label)){
    const topExact=strictIndexes.find(index=>index<20)??strictIndexes[0];
    if(topExact!==undefined&&topExact>=0)return{targets:[lines[topExact]],context:headerContext(lines,topExact)};
  }
  if(/CNPJ do Cliente/i.test(label)){
    const recipientIndex=findLineByTerms(lines,['DESTINATÁRIO / REMETENTE','DESTINATARIO / REMETENTE']);
    const headerEnd=recipientIndex>0?recipientIndex:Math.min(lines.length,30);
    const header=lines.slice(0,headerEnd);
    const cnpjLabelIndex=header.findIndex(line=>/^CNPJ$/i.test(line.text.trim())||line.normalized==='CNPJ'||line.normalized.startsWith('CNPJ'));
    if(cnpjLabelIndex>=0){
      const nv=norm(value);
      for(let i=cnpjLabelIndex;i<=Math.min(header.length-1,cnpjLabelIndex+2);i++){
        if(header[i].normalized.includes(nv))return{targets:[header[i]],context:header.slice(Math.max(0,cnpjLabelIndex-1),Math.min(header.length,cnpjLabelIndex+3))};
      }
      const fallback=header.findIndex((line,index)=>index>=cnpjLabelIndex&&index<=cnpjLabelIndex+3&&/\d{14}/.test(line.normalized));
      if(fallback>=0)return{targets:[header[fallback]],context:header.slice(Math.max(0,cnpjLabelIndex-1),Math.min(header.length,cnpjLabelIndex+3))};
      return{targets:[header[cnpjLabelIndex]],context:header.slice(Math.max(0,cnpjLabelIndex-1),Math.min(header.length,cnpjLabelIndex+3))};
    }
  }
  if(/Local de Armazenagem/i.test(label)){
    const anchor=findLineByTerms(lines,['RECINTO ALFANDEGADO']);if(anchor>=0){const context=[lines[anchor]],targets:TextLine[]=[];for(let i=anchor;i<=Math.min(lines.length-1,anchor+2);i++){context.push(lines[i]);if(lineHasValue(lines[i],value)||/RECINTOALFANDEGADO/i.test(lines[i].normalized))targets.push(lines[i])}if(!targets.length)targets.push(lines[anchor]);return{targets:[...new Set(targets)],context:[...new Set(context)]}}
  }
  if(/Ref\. do Cliente/i.test(label)){
    const anchor=findLineByTerms(lines,['REF CLIENTE','REF. CLIENTE']);if(anchor>=0)return{targets:[lines[anchor]],context:[lines[anchor]]};
  }
  if(/Nº Documento/i.test(label)){
    const anchor=findLineByTerms(lines,['NUMERO DA DECLARACAO','NÚMERO DA DECLARAÇÃO']);if(anchor>=0)return{targets:[lines[anchor]],context:[lines[anchor]]};
  }
  if(/Valor Total da Nota/i.test(label)){
    const anchor=findLineByTerms(lines,['VALOR TOTAL DA NOTA']);if(anchor>=0){const valueIndex=valueLineIndexes.find(i=>i>=anchor&&i<=anchor+3)??strictIndexes[0]??valueLineIndexes[0];if(valueIndex!==undefined&&valueIndex>=0)return{targets:[lines[valueIndex]],context:[lines[anchor],lines[valueIndex]]};return{targets:[lines[anchor]],context:[lines[anchor]]}}
  }
  return null;
}
function selectPdfItems(items:PdfTextItem[],value:string,label:string,viewport:any,scale:number){const exact=exactFieldSelection(items,value,label);if(exact)return{selected:exact.targets.flatMap(line=>line.items),context:exact.context.flatMap(line=>line.items)};const matches=findValue(items,value),anchors=findAnchors(items,anchorTerms(label));let selected:PdfTextItem[];if(/Remetente|Exportador|CNPJ do Cliente|Peso Líquido|Valor Total da Nota/i.test(label))selected=nearest(matches,anchors,viewport,scale,'below');else if(/Local de Armazenagem|Ref\. do Cliente|Nº Documento/i.test(label))selected=nearest(matches,anchors,viewport,scale,'right');else selected=nearest(matches,anchors,viewport,scale,'near');return{selected,context:[...anchors,...selected]}}
function crop(canvas:HTMLCanvasElement,boxes:Box[]){if(!boxes.length)return canvas;const minX=Math.min(...boxes.map(b=>b.x)),minY=Math.min(...boxes.map(b=>b.y)),maxX=Math.max(...boxes.map(b=>b.x+b.w)),maxY=Math.max(...boxes.map(b=>b.y+b.h)),px=75,py=45,sx=Math.max(0,Math.floor(minX-px)),sy=Math.max(0,Math.floor(minY-py)),sw=Math.min(canvas.width-sx,Math.ceil(maxX-minX+px*2)),sh=Math.min(canvas.height-sy,Math.ceil(maxY-minY+py*2));const out=document.createElement('canvas');out.width=Math.max(1,sw);out.height=Math.max(1,sh);out.getContext('2d')?.drawImage(canvas,sx,sy,sw,sh,0,0,sw,sh);return out}

async function renderPdf(row:HTMLElement,parsed:NonNullable<ReturnType<typeof parsePdfSource>>,container:HTMLElement){
  const all=await pdfCandidates(),candidate=all.find(x=>sameFile(x.filename,parsed.filename));if(!candidate)throw new Error('O PDF usado como fonte não está mais disponível nesta análise.');
  const pdf=await getDocument({data:new Uint8Array(candidate.bytes.slice(0))}).promise;if(parsed.page<1||parsed.page>pdf.numPages)throw new Error('Página da fonte não localizada.');
  const page=await pdf.getPage(parsed.page),scale=1.9,viewport=page.getViewport({scale}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Não foi possível gerar o print.');
  await page.render({canvas,canvasContext:ctx,viewport}).promise;
  const content=await page.getTextContent(),items=content.items as PdfTextItem[],{label,value}=rowData(row),selection=selectPdfItems(items,value,label,viewport,scale);
  const targetLineBoxes:Box[]=[];const targetLines=textLines(selection.selected);if(targetLines.length){for(const line of targetLines){const b=mergeBoxes(line.items.map(i=>itemBox(i,viewport,scale)));if(b)targetLineBoxes.push(b)}}else{const b=mergeBoxes(selection.selected.map(i=>itemBox(i,viewport,scale)));if(b)targetLineBoxes.push(b)}
  targetLineBoxes.forEach(b=>drawBox(ctx,canvas,b));
  const contextBoxes=selection.context.map(i=>itemBox(i,viewport,scale));const output=crop(canvas,[...targetLineBoxes,...contextBoxes]);
  const wrap=document.createElement('div');wrap.className='client-report-source-preview-card';const caption=document.createElement('div');caption.className='client-report-source-preview-caption';caption.textContent=`Print da NF · ${parsed.filename} · página ${parsed.page} · ${parsed.note} · clique para ampliar`;
  const img=document.createElement('img');img.className='client-report-source-preview-image';img.src=output.toDataURL('image/png');img.alt=`Print da fonte ${label} na NF`;img.tabIndex=0;img.setAttribute('role','button');img.addEventListener('click',()=>openPreview(img.src,img.alt));img.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openPreview(img.src,img.alt)}});wrap.append(caption,img);
  if(!targetLineBoxes.length){const n=document.createElement('div');n.className='client-report-preview-marker-note';n.textContent='A área correta do campo foi localizada; o PDF não separou o valor em um bloco de texto individual para marcação.';wrap.append(n)}container.appendChild(wrap)
}

function parseCell(ref:string){const m=ref.trim().match(/^([A-Z]+)(\d+)$/i);if(!m)return null;let col=0;for(const ch of m[1].toUpperCase())col=col*26+(ch.charCodeAt(0)-64);return{row:Number(m[2])-1,col:col-1}}
function colName(index:number){let n=index+1,out='';while(n){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26)}return out}
async function renderExcel(parsed:NonNullable<ReturnType<typeof parseExcelSource>>,container:HTMLElement){const snap=await spreadsheet(),sh=snap.sheets.find(s=>s.name===parsed.sheet);if(!sh)throw new Error(`A aba ${parsed.sheet} não foi localizada na planilha.`);const refs=parsed.cells.split(',').map(parseCell).filter(Boolean) as Array<{row:number;col:number}>;if(!refs.length)throw new Error('As células de origem não puderam ser identificadas.');const minRow=Math.max(0,Math.min(...refs.map(r=>r.row))-3),maxRow=Math.min(sh.rows.length-1,Math.max(...refs.map(r=>r.row))+5),minCol=Math.max(0,Math.min(...refs.map(r=>r.col))-2),maxCol=Math.max(...refs.map(r=>r.col))+3,cellW=170,rowH=34,headH=34,rowLabelW=48,width=rowLabelW+(maxCol-minCol+1)*cellW,height=headH+(maxRow-minRow+1)*rowH,canvas=document.createElement('canvas');canvas.width=Math.min(width,1600);canvas.height=Math.min(height,900);const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Não foi possível gerar o print da planilha.');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.font='13px Arial';ctx.textBaseline='middle';for(let c=minCol;c<=maxCol;c++){const x=rowLabelW+(c-minCol)*cellW;ctx.fillStyle='#f2f2f2';ctx.fillRect(x,0,cellW,headH);ctx.strokeStyle='#cfcfcf';ctx.strokeRect(x,0,cellW,headH);ctx.fillStyle='#444';ctx.fillText(colName(c),x+8,headH/2)}for(let r=minRow;r<=maxRow;r++){const y=headH+(r-minRow)*rowH;ctx.fillStyle='#f2f2f2';ctx.fillRect(0,y,rowLabelW,rowH);ctx.strokeStyle='#cfcfcf';ctx.strokeRect(0,y,rowLabelW,rowH);ctx.fillStyle='#555';ctx.fillText(String(r+1),8,y+rowH/2);for(let c=minCol;c<=maxCol;c++){const x=rowLabelW+(c-minCol)*cellW,hit=refs.some(q=>q.row===r&&q.col===c);ctx.fillStyle=hit?'rgba(200,16,46,.14)':'#fff';ctx.fillRect(x,y,cellW,rowH);ctx.strokeStyle=hit?'#c8102e':'#d9d9d9';ctx.lineWidth=hit?3:1;ctx.strokeRect(x,y,cellW,rowH);ctx.fillStyle='#222';ctx.font='12px Arial';const t=String(sh.rows[r]?.[c]||'');ctx.save();ctx.beginPath();ctx.rect(x+4,y+2,cellW-8,rowH-4);ctx.clip();ctx.fillText(t,x+7,y+rowH/2);ctx.restore()}}const wrap=document.createElement('div');wrap.className='client-report-source-preview-card';const caption=document.createElement('div');caption.className='client-report-source-preview-caption';caption.textContent=`Print da planilha · ${parsed.filename} · aba ${parsed.sheet} · ${parsed.cells} · ${parsed.note} · clique para ampliar`;const img=document.createElement('img');img.className='client-report-source-preview-image';img.src=canvas.toDataURL('image/png');img.alt=`Print da planilha ${parsed.sheet}`;img.tabIndex=0;img.setAttribute('role','button');img.addEventListener('click',()=>openPreview(img.src,img.alt));wrap.append(caption,img);container.appendChild(wrap)}

async function buildPreview(row:HTMLElement,source:string,container:HTMLElement){if(container.dataset.loading==='true'||container.dataset.loaded==='true')return;container.dataset.loading='true';container.innerHTML='<div class="client-report-preview-loading">Gerando print da fonte...</div>';try{container.replaceChildren();const pdf=parsePdfSource(source),excel=parseExcelSource(source);if(pdf)await renderPdf(row,pdf,container);else if(excel)await renderExcel(excel,container);else container.innerHTML='<div class="client-report-preview-unavailable">Esta informação vem de uma regra exclusiva da XCMG; não existe um trecho de arquivo para imprimir.</div>';container.dataset.loaded='true'}catch(error){container.innerHTML=`<div class="client-report-preview-unavailable">${esc(error instanceof Error?error.message:'Não foi possível gerar o print da fonte.')}</div>`;container.dataset.loaded='true'}finally{delete container.dataset.loading}}
function enhance(root:ParentNode=document){const rows=root===document?document.querySelectorAll<HTMLElement>('.xcmg-report-view .client-report-row'):root instanceof HTMLElement&&root.matches('.client-report-row')&&root.closest('.xcmg-report-view')?[root]:root.querySelectorAll<HTMLElement>('.client-report-row');rows.forEach((row,index)=>{if(!row.closest('.xcmg-report-view')||row.dataset.xcmgSourceEnhanced==='true')return;const field=row.querySelector<HTMLElement>('.client-report-field'),confidence=row.querySelector<HTMLElement>('.client-report-confidence');if(!field||!confidence)return;let detail=row.querySelector<HTMLElement>('.client-report-source-detail'),toggle=row.querySelector<HTMLButtonElement>('.client-report-source-toggle');const sourceText=detail?.querySelector<HTMLElement>(':scope > span')?.textContent?.trim()||field.querySelector<HTMLElement>('span')?.textContent?.trim()||'Fonte não informada.';if(detail)detail.remove();if(toggle)toggle.remove();field.querySelector<HTMLElement>('span')?.remove();const old=confidence.querySelector<HTMLElement>('.client-report-confidence-text'),statusText=(old?.textContent||confidence.textContent||'').trim();confidence.replaceChildren();const status=document.createElement('span');status.className='client-report-confidence-text';status.textContent=statusText;toggle=document.createElement('button');toggle.type='button';toggle.className='client-report-source-toggle';toggle.setAttribute('aria-expanded','false');toggle.innerHTML='<span aria-hidden="true">⌄</span>';detail=document.createElement('div');detail.className='client-report-source-detail';detail.id=`xcmg-report-source-${Date.now()}-${index}`;detail.hidden=true;detail.innerHTML=`<b>Fonte da informação</b><span>${esc(sourceText)}</span><div class="client-report-source-preview"></div>`;toggle.setAttribute('aria-controls',detail.id);confidence.append(status,toggle);row.appendChild(detail);const preview=detail.querySelector<HTMLElement>('.client-report-source-preview')!;toggle.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();const open=toggle!.getAttribute('aria-expanded')==='true';toggle!.setAttribute('aria-expanded',String(!open));detail!.hidden=open;row.classList.toggle('source-open',!open);if(!open)void buildPreview(row,sourceText,preview)});row.dataset.sourceEnhanced='true';row.dataset.xcmgSourceEnhanced='true'})}
const observer=new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n instanceof Element&&(n.closest('.xcmg-report-view')||n.matches('.xcmg-report-view')||n.querySelector('.xcmg-report-view')))enhance(document)});const start=()=>{enhance();observer.observe(document.documentElement,{childList:true,subtree:true})};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();