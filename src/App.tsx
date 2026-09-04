import { useMemo, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { createWorker } from 'tesseract.js';
import JSZip from 'jszip';
import { AlertTriangle, Archive, Check, ChevronRight, Clipboard, FilePlus2, FileText, Loader2, RotateCcw, Sparkles, X, Zap } from 'lucide-react';
import './styles.css';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

type Confidence = 'high' | 'medium' | 'low';
type DocKind = 'DOC COMPLETO' | 'NF FISCAL' | 'ZIP PDF';
type Field = { key:string; label:string; value:string|null; confidence:Confidence; page:number|null; source:string; edited?:boolean };
type PdfPage = { page:number; text:string; ocr:boolean; document:DocKind; filename:string };
type ReadResult = { pages:PdfPage[]; total:number; name:string; kind:DocKind };
type Analysis = { process_type:'IMPORTAÇÃO'|'EXPORTAÇÃO'|'NÃO IDENTIFICADO'; fields:Field[]; pages:number; filename:string; ocr_pages:string[]; documents:string[] };

const labels:Record<string,string> = {
  cliente:'Cliente', tipo_documento:'Tipo Documento', remetente:'Remetente / Exportador', numero_bl_awb:'Nº BL / AWB',
  local_armazenagem:'Local de Armazenagem', ref_cliente:'Ref. do Cliente', numero_documento:'Nº Documento', destinatario:'Destinatário / Importador',
  operacao_maritima:'Operação Marítima', cnpj_cliente:'CNPJ do Cliente / Importador', conteineres:'Contêineres', peso_liquido:'Peso Líquido', valor_total_nota:'Valor Total da Nota'
};
const keys = Object.keys(labels);
const clean = (s:string) => s.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const one = (s:string) => clean(s).replace(/\n/g,' ').trim();
const norm = (s:string|null) => one(s||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');
const normCnpj = (s:string|null) => one(s||'').replace(/\D/g,'');
const numberBR = (v:string) => Number(v.replace(/\./g,'').replace(',','.'));
const source = (p:PdfPage,v:string) => `${p.document} · ${p.filename} · página ${p.page}: ${v}`;

function result(value:string|null,page:number|null,sourceText:string,confidence:Confidence='high') {
  return { value, page, source:sourceText, confidence:value ? confidence : 'low' as Confidence };
}
function textItemsToLines(items:any[]):string {
  let lastY:number|null=null,current=''; const lines:string[]=[];
  for (const raw of items) {
    if (!('str' in raw)) continue;
    const item=raw as TextItem; const str=item.str?.trim(); if (!str) continue;
    const y=Array.isArray((item as any).transform)?Number((item as any).transform[5]):null;
    if (lastY!==null && y!==null && Math.abs(y-lastY)>2.4) { if (current.trim()) lines.push(current.trim()); current=str; }
    else current+=(current?' ':'')+str;
    if (y!==null) lastY=y;
  }
  if (current.trim()) lines.push(current.trim());
  return clean(lines.join('\n'));
}
async function mapLimit<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>):Promise<R[]> {
  const out=new Array<R>(items.length); let cursor=0;
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{ while(true){ const i=cursor++; if(i>=items.length) break; out[i]=await fn(items[i]); } });
  await Promise.all(workers); return out;
}
async function renderForOcr(page:any) {
  const viewport=page.getViewport({scale:2.2}); const canvas=document.createElement('canvas');
  canvas.width=Math.ceil(viewport.width); canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext('2d'); if(!ctx) return null;
  await page.render({canvasContext:ctx,viewport}).promise; return canvas;
}
async function readPdfData(data:ArrayBuffer|Uint8Array,kind:DocKind,name:string):Promise<ReadResult> {
  const pdf=await getDocument({data}).promise;
  const nums=Array.from({length:pdf.numPages},(_,i)=>i+1);
  const pages=await mapLimit(nums,8,async i=>{
    const p=await pdf.getPage(i); const content=await p.getTextContent();
    return {page:i,text:textItemsToLines(content.items as any[]),ocr:false,document:kind,filename:name} as PdfPage;
  });
  const targets:number[]=[];
  if (kind==='DOC COMPLETO') targets.push(1);
  if (kind==='DOC COMPLETO') for (const n of [4,5]) { const p=pages[n-1]; if(p&&p.text.replace(/\s/g,'').length<35) targets.push(n); }
  if (kind==='NF FISCAL' && pages[0] && !/TRANSPORTADOR\s*\/\s*VOLUMES\s*TRANSPORTADOS|VALOR\s+TOTAL\s+DA\s+NOTA|PESO\s+L[IÍ]QUIDO/i.test(pages[0].text)) targets.push(1);
  if (kind==='ZIP PDF') for (const p of pages) if(p.text.replace(/\s/g,'').length<35) targets.push(p.page);
  if (targets.length) {
    let worker:any=null;
    try {
      worker=await createWorker('eng+por'); await worker.setParameters({preserve_interword_spaces:'1'});
      for (const n of [...new Set(targets)]) {
        try {
          const page=await pdf.getPage(n); const canvas=await renderForOcr(page); if(!canvas) continue;
          const r=await worker.recognize(canvas); const o=clean(r.data.text||'');
          if(o.length>20) pages[n-1]={...pages[n-1],text:clean(`${pages[n-1].text}\n${o}`),ocr:true};
        } catch {}
      }
    } finally { if(worker) await worker.terminate(); }
  }
  return {pages,total:pdf.numPages,name,kind};
}
async function readPdf(file:File,kind:DocKind){ return readPdfData(await file.arrayBuffer(),kind,file.name); }

function find(pages:PdfPage[],patterns:RegExp[],preferred:number[]=[]):ReturnType<typeof result> {
  const ordered=[...preferred.flatMap(n=>pages.filter(p=>p.page===n)),...pages.filter(p=>!preferred.includes(p.page))];
  for (const p of ordered) for (const re of patterns) { const m=p.text.match(re); if(m?.[1]) return result(one(m[1]),p.page,source(p,one(m[1]))); }
  return result(null,null,'Não localizado nos PDFs analisados','low');
}
function lines(p?:PdfPage){ return p?p.text.split(/\n+/).map(one).filter(Boolean):[]; }
function afterLabel(p:PdfPage|undefined,label:RegExp,skip:RegExp[]=[]):ReturnType<typeof result> {
  if(!p) return result(null,null,'Página não disponível','low');
  const ls=lines(p);
  for(let i=0;i<ls.length;i++){
    if(!label.test(ls[i])) continue;
    const same=ls[i].replace(label,'').replace(/^\s*[:\-]\s*/,'').trim();
    if(same.length>2&&!skip.some(r=>r.test(same))) return result(same,p.page,source(p,same));
    for(let j=i+1;j<Math.min(i+8,ls.length);j++){ const c=ls[j]; if(c.length<2||skip.some(r=>r.test(c))) continue; return result(c,p.page,source(p,c)); }
  }
  return result(null,null,`${p.document} · ${p.filename} · página ${p.page}: campo não localizado`,'low');
}
function normalizeCompany(v:string|null){ return v?one(v).replace(/^OPE_\d+\s*-\s*/i,'').replace(/\s+(CNPJ|TAX ID|ADDRESS|ENDERE[CÇ]O|ZIP CODE).*$/i,'').trim():null; }
function normalizeBL(v:string|null){ return v?v.replace(/[^A-Z0-9]/gi,'').toUpperCase():null; }
function normalizeContainers(v:string|null){ if(!v)return null; const a=[...v.matchAll(/\b[A-Z]{4}\s*\d{7}\b/gi)].map(m=>m[0].replace(/\s/g,'').toUpperCase()); return a.length?[...new Set(a)].join(' / '):one(v); }
function formatCnpj(v:string|null){ const d=normCnpj(v); if(d.length!==14)return v; return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`; }

function customerFromDoc(p?:PdfPage){ const r=afterLabel(p,/For\s+delivery\s+of\s+goods\s+please\s+apply\s+to\s*:?/i,[/CNPJ|ZIP|AVENIDA|STREET|RUA|PORT OF|B\/L/i]); if(r.value)r.value=normalizeCompany(r.value); return r; }
function customerFromNf(p?:PdfPage){
  if(!p)return result(null,null,'NF Fiscal não enviada','low'); const ls=lines(p); let inTransport=false;
  for(let i=0;i<ls.length;i++){
    if(/TRANSPORTADOR\s*\/\s*VOLUMES\s*TRANSPORTADOS/i.test(ls[i])) inTransport=true;
    if(inTransport&&/RAZ[AÃ]O\s+SOCIAL/i.test(ls[i])){
      const same=ls[i].replace(/.*RAZ[AÃ]O\s+SOCIAL\s*/i,'').trim();
      if(same.length>3&&!/FRETE|CNPJ|ENDERE[CÇ]O/i.test(same))return result(normalizeCompany(same),p.page,source(p,same));
      for(let j=i+1;j<Math.min(i+5,ls.length);j++){const c=ls[j];if(/ENDERE[CÇ]O|FRETE|CNPJ|QUANTIDADE|ESP[EÉ]CIE/i.test(c))continue;if(c.length>3)return result(normalizeCompany(c),p.page,source(p,c));}
    }
  }
  return find([p],[/TRANSPORTADOR[\s\S]{0,260}?RAZ[AÃ]O SOCIAL\s*\n?\s*([^\n]+)/i],[1]);
}
function cnpjFromDoc(p?:PdfPage){ if(!p)return result(null,null,'DOC COMPLETO não enviado','low'); const m=p.text.match(/For\s+delivery\s+of\s+goods\s+please\s+apply\s+to[\s\S]{0,600}?CNPJ\s*(?:NO\.?)?\s*[:.]?\s*([0-9./-]{14,20})/i); return m?.[1]?result(formatCnpj(m[1]),p.page,source(p,formatCnpj(m[1])||m[1])):result(null,null,'CNPJ do cliente não localizado no bloco de entrega','low'); }
function cnpjFromNf(p?:PdfPage){ if(!p)return result(null,null,'NF Fiscal não enviada','low'); const m=p.text.match(/TRANSPORTADOR\s*\/\s*VOLUMES\s*TRANSPORTADOS[\s\S]{0,900}?CNPJ\s*(?:\/\s*CPF)?[\s\S]{0,120}?([0-9]{2}\.?[0-9]{3}\.?[0-9]{3}\/?[0-9]{4}-?[0-9]{2})/i); if(m?.[1])return result(formatCnpj(m[1]),p.page,source(p,formatCnpj(m[1])||m[1])); const all=[...p.text.matchAll(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/g)]; return all.length?result(formatCnpj(all[all.length-1][1]),p.page,source(p,all[all.length-1][1])):result(null,null,'CNPJ do transportador não localizado','low'); }
function weightFromDoc(p?:PdfPage){ if(!p)return result(null,null,'DOC COMPLETO · página 5 não disponível','low'); const idx=p.text.search(/Peso\s+L[ií]quido\s*\(kg\)\s*:/i); if(idx<0)return result(null,null,'Peso Líquido não localizado na página 5','low'); const vals=[...p.text.slice(idx,idx+220).matchAll(/\b(\d{1,3}(?:\.\d{3})*,\d{3,5}|\d{4,},\d{3,5})\b/g)].map(m=>m[1]); const v=vals.find(x=>numberBR(x)>0)||null; return v?result(`${v} kg`,5,source(p,`${v} kg`)):result(null,null,'Valor do Peso Líquido não localizado','low'); }
function weightFromNf(p?:PdfPage){
  if(!p)return result(null,null,'NF Fiscal não enviada','low'); const start=p.text.search(/TRANSPORTADOR\s*\/\s*VOLUMES\s*TRANSPORTADOS/i); if(start<0)return result(null,null,'Quadro Transportador/Volumes não localizado','low');
  const tail=p.text.slice(start); const end=tail.search(/DADOS\s+DO\s+PRODUTO\s*\/\s*SERVI[CÇ]O|DADOS\s+DOS\s+PRODUTOS|C[ÓO]DIGO\s+PRODUTO/i); const block=end>0?tail.slice(0,end):tail.slice(0,2600); const idx=block.search(/PESO\s+L[IÍ]QUIDO/i); if(idx<0)return result(null,null,'PESO LÍQUIDO não localizado no quadro do transportador','low');
  const direct=block.slice(idx,idx+220).match(/PESO\s+L[IÍ]QUIDO\s*[:\-]?\s*([0-9]{1,3}(?:\.\d{3})*,\d{3,5}|[0-9]{4,},\d{3,5})/i); if(direct?.[1]&&numberBR(direct[1])>0)return result(`${direct[1]} kg`,1,source(p,`${direct[1]} kg`));
  const ls=block.split(/\n+/).map(one).filter(Boolean); const li=ls.findIndex(x=>/PESO\s+L[IÍ]QUIDO/i.test(x));
  for(let i=Math.max(0,li);li>=0&&i<Math.min(li+4,ls.length);i++){ if(/VL\.?\s*UNIT|VALOR\s+UNIT|QUANTIDADE|PESO\s+BRUTO|MARCA|NUMERA[CÇ][AÃ]O/i.test(ls[i]))continue; const m=ls[i].match(/\b([0-9]{1,3}(?:\.\d{3})*,\d{3,5}|[0-9]{4,},\d{3,5})\b/); if(m?.[1]&&numberBR(m[1])>0)return result(`${m[1]} kg`,1,source(p,`${m[1]} kg`)); }
  return result(null,null,'Valor do PESO LÍQUIDO não localizado no quadro do transportador','low');
}
function totalFromNf(p?:PdfPage){ if(!p)return result(null,null,'NF Fiscal não enviada','low'); const idx=p.text.search(/VALOR\s+TOTAL\s+DA\s+NOTA/i); if(idx<0)return result(null,null,'VALOR TOTAL DA NOTA não localizado','low'); const vals=[...p.text.slice(idx,idx+500).matchAll(/\b(\d{1,3}(?:\.\d{3})*,\d{2}|\d{4,},\d{2})\b/g)].map(m=>m[1]).filter(v=>numberBR(v)>0); if(!vals.length)return result(null,null,'Valor total não localizado','low'); const v=[...vals].sort((a,b)=>numberBR(b)-numberBR(a))[0]; return result(`R$ ${v}`,1,source(p,`R$ ${v}`)); }

function processTypeFrom(text:string):Analysis['process_type'] { return /\bDUIMP\b|Nome do importador|Importa[cç][aã]o/i.test(text)?'IMPORTAÇÃO':(/\bDUE\b|Nome do exportador|Exporta[cç][aã]o/i.test(text)?'EXPORTAÇÃO':'NÃO IDENTIFICADO'); }

function analyzeDocuments(results:ReadResult[]):Analysis {
  const all=results.flatMap(r=>r.pages), doc=results.find(r=>r.kind==='DOC COMPLETO'), nf=results.find(r=>r.kind==='NF FISCAL');
  const docPages=doc?.pages||[], nfPages=nf?.pages||[], doc1=docPages.find(p=>p.page===1), doc5=docPages.find(p=>p.page===5), nf1=nfPages.find(p=>p.page===1), full=all.map(p=>p.text).join('\n');
  const values:Record<string,ReturnType<typeof result>>={}; const processType=processTypeFrom(full);
  const cd=customerFromDoc(doc1),cn=customerFromNf(nf1); if(cd.value&&cn.value){const same=norm(cd.value)===norm(cn.value);values.cliente=result(cd.value,1,same?`Confirmado nos 2 PDFs: ${cd.value}`:`Divergência: DOC=${cd.value} | NF=${cn.value}`,same?'high':'medium')}else values.cliente=cd.value?cd:cn;
  const types=[/\bDUIMP\b/i.test(full)?'DUIMP':null,/\bDUE\b/i.test(full)?'DUE':null,/\bDANFE\b|NF-?e/i.test(full)?'NF-e':null].filter(Boolean).join(' + '); values.tipo_documento=result(types||(/BILL OF LADING|B\/L/i.test(full)?'BL':null),null,'Tipo identificado nos documentos');
  values.remetente=afterLabel(doc1,/\bConsignor\s*\/\s*Shipper\b/i,[/Port of Loading|Consignee|Notify|B\/L|Bill of Lading|Address/i]); if(!values.remetente.value)values.remetente=find(docPages,[/C[oó]digo do Exportador Estrangeiro:\s*\n?\s*(?:OPE_\d+\s*-\s*)?([^\n]+)/i],[1]); if(values.remetente.value)values.remetente.value=normalizeCompany(values.remetente.value);
  values.numero_bl_awb=find(docPages,[/Conhecimento\.{0,10}:\s*([A-Z0-9-]{8,})/i,/B\/?L(?:\s*(?:No|Nº|NUMBER))?\s*[:#-]?\s*([A-Z0-9-]{8,})/i],[1,4]); if(values.numero_bl_awb.value)values.numero_bl_awb.value=normalizeBL(values.numero_bl_awb.value);
  values.local_armazenagem=find(docPages,[/Recinto Alfandeg[aá]rio\.{0,10}:\s*([^\n]+)/i,/Setor Alfandeg[aá]rio\.{0,10}:\s*([^\n]+)/i],[4,5]);
  values.ref_cliente=find(docPages,[/REF\.?\s*IMPORTADOR\.{0,10}:\s*([A-Z0-9./-]+)/i,/Nossa Refer[eê]ncia\.{0,10}:\s*([A-Z0-9./-]+)/i],[4]);
  values.numero_documento=find(docPages,[/Extrato da Duimp\s+([0-9A-Z-]{10,25})/i,/\bDUIMP\s*[:.]?\s*([0-9A-Z-]{10,25})/i,/\bDUE\s*[:.]?\s*([0-9A-Z-]{10,25})/i],[4]);
  values.destinatario=find(docPages,[/Nome do importador:\s*\n?\s*([^\n]+)/i,/Consignee[^\n]*\n\s*([^\n]+)/i],[4,1]); if(values.destinatario.value)values.destinatario.value=normalizeCompany(values.destinatario.value);
  values.operacao_maritima=result(processType==='IMPORTAÇÃO'?'Importação':processType==='EXPORTAÇÃO'?'Exportação':null,null,'Operação definida pelo documento aduaneiro');
  const c1=cnpjFromDoc(doc1),c2=cnpjFromNf(nf1); if(c1.value&&c2.value){const same=normCnpj(c1.value)===normCnpj(c2.value);values.cnpj_cliente=result(c1.value,1,same?`Confirmado nos 2 PDFs: ${c1.value}`:`Divergência: DOC=${c1.value} | NF=${c2.value}`,same?'high':'medium')}else values.cnpj_cliente=c1.value?c1:c2;
  values.conteineres=find(docPages,[/CONTEINER:\s*([^\n]+)/i,/((?:\b[A-Z]{4}\s*\d{7}\b[^\n]{0,100}){1,5})/i],[4,1]); if(values.conteineres.value)values.conteineres.value=normalizeContainers(values.conteineres.value);
  const w1=weightFromDoc(doc5),w2=weightFromNf(nf1); if(w1.value&&w2.value){const same=Math.abs(numberBR(w1.value.replace(/\s*kg/i,''))-numberBR(w2.value.replace(/\s*kg/i,'')))<=0.05;values.peso_liquido=result(w1.value,5,same?`Confirmado nos 2 PDFs: DOC=${w1.value} | NF=${w2.value}`:`Revisar NF: DOC=${w1.value} | NF=${w2.value}. Mantido DOC COMPLETO.`,same?'high':'medium')}else values.peso_liquido=w1.value?w1:w2;
  values.valor_total_nota=totalFromNf(nf1);
  return {process_type:processType,fields:keys.map(key=>({key,label:labels[key],...values[key]})),pages:results.reduce((a,r)=>a+r.total,0),filename:results.map(r=>r.name).join(' + '),ocr_pages:all.filter(p=>p.ocr).map(p=>`${p.filename} p.${p.page}`),documents:results.map(r=>r.kind)};
}

function analyzeZipResults(results:ReadResult[],zipName:string):Analysis {
  const pages=results.flatMap(r=>r.pages), full=pages.map(p=>p.text).join('\n'); const values:Record<string,ReturnType<typeof result>>={};
  const set=(key:string,patterns:RegExp[])=>{values[key]=find(pages,patterns)};
  set('cliente',[/For\s+delivery\s+of\s+goods\s+please\s+apply\s+to\s*:?\s*\n?\s*([^\n]+)/i,/TRANSPORTADOR[\s\S]{0,260}?RAZ[AÃ]O\s+SOCIAL\s*\n?\s*([^\n]+)/i,/Nome do importador:\s*\n?\s*([^\n]+)/i,/NOME\s*\/\s*RAZ[AÃ]O\s+SOCIAL\s*\n?\s*([^\n]+)/i]); if(values.cliente.value)values.cliente.value=normalizeCompany(values.cliente.value);
  const types=[/\bDUIMP\b/i.test(full)?'DUIMP':null,/\bDUE\b/i.test(full)?'DUE':null,/\bDANFE\b|NF-?e/i.test(full)?'NF-e':null,/BILL OF LADING|B\/L/i.test(full)?'BL':null].filter(Boolean).join(' + '); values.tipo_documento=result(types||null,null,'Tipo(s) identificado(s) nos PDFs do ZIP');
  set('remetente',[/Consignor\s*\/\s*Shipper\s*\n?\s*([^\n]+)/i,/SHIPPER(?:'S)?(?: NAME AND ADDRESS)?\s*[:\-]?\s*\n?\s*([^\n]+)/i,/EXPORTER\s*[:\-]?\s*([^\n]+)/i,/C[oó]digo do Exportador Estrangeiro:\s*\n?\s*(?:OPE_\d+\s*-\s*)?([^\n]+)/i]); if(values.remetente.value)values.remetente.value=normalizeCompany(values.remetente.value);
  set('numero_bl_awb',[/Conhecimento\.{0,10}:\s*([A-Z0-9-]{8,})/i,/B\/?L(?:\s*(?:No|Nº|NUMBER))?\s*[:#-]?\s*([A-Z0-9-]{8,})/i,/AWB\s*[:#-]?\s*([A-Z0-9-]{8,})/i]); if(values.numero_bl_awb.value)values.numero_bl_awb.value=normalizeBL(values.numero_bl_awb.value);
  set('local_armazenagem',[/Recinto Alfandeg[aá]rio\.{0,10}:\s*([^\n]+)/i,/Setor Alfandeg[aá]rio\.{0,10}:\s*([^\n]+)/i,/(?:TERMINAL|WAREHOUSE|PLACE OF STORAGE)\s*[:\-]?\s*([^\n]+)/i]);
  set('ref_cliente',[/REF\.?\s*IMPORTADOR\.{0,10}:\s*([A-Z0-9./-]+)/i,/REF\.?\s*EXPORTADOR\.{0,10}:\s*([A-Z0-9./-]+)/i,/Nossa Refer[eê]ncia\.{0,10}:\s*([A-Z0-9./-]+)/i,/REF(?:ER[EÊ]NCIA)?\.?\s*(?:CLIENTE)?\s*[:\-]\s*([A-Z0-9./-]+)/i]);
  set('numero_documento',[/Extrato da Duimp\s+([0-9A-Z-]{10,25})/i,/\bDUIMP\s*[:.]?\s*([0-9A-Z-]{10,25})/i,/\bDUE\s*[:.]?\s*([0-9A-Z-]{10,25})/i,/N[ºO.]?\s*(?:DA\s+)?NOTA\s*[:\-]?\s*([0-9]{4,15})/i]);
  set('destinatario',[/Nome do importador:\s*\n?\s*([^\n]+)/i,/Consignee(?:\s*\/\s*Importer)?[^\n]*\n\s*([^\n]+)/i,/DESTINAT[ÁA]RIO\s*\/\s*REMETENTE[\s\S]{0,180}?NOME\s*\/\s*RAZ[AÃ]O\s+SOCIAL\s*\n?\s*([^\n]+)/i]); if(values.destinatario.value)values.destinatario.value=normalizeCompany(values.destinatario.value);
  const processType=processTypeFrom(full); values.operacao_maritima=result(processType==='IMPORTAÇÃO'?'Importação':processType==='EXPORTAÇÃO'?'Exportação':null,null,'Operação inferida pelo conjunto de PDFs do ZIP');
  set('cnpj_cliente',[/CNPJ\s*(?:NO\.?|N[ºO])?\s*[:.]?\s*([0-9]{2}\.?[0-9]{3}\.?[0-9]{3}\/?[0-9]{4}-?[0-9]{2})/i,/CNPJ\s*\/\s*CPF\s*\n?\s*([0-9./-]{14,20})/i]); if(values.cnpj_cliente.value)values.cnpj_cliente.value=formatCnpj(values.cnpj_cliente.value);
  const containers=[...full.matchAll(/\b[A-Z]{4}\s*\d{7}\b/gi)].map(m=>m[0].replace(/\s/g,'').toUpperCase()); values.conteineres=result(containers.length?[...new Set(containers)].join(' / '):null,null,containers.length?'Contêineres encontrados ao longo dos PDFs do ZIP':'Contêineres não localizados');
  set('peso_liquido',[/Peso\s+L[ií]quido\s*(?:\(kg\))?\s*[:\-]?\s*([0-9.]+,[0-9]{3,5})/i,/PESO\s+L[IÍ]QUIDO\s*[:\-]?\s*([0-9.]+,[0-9]{3,5})/i,/NET WEIGHT(?:\s*\(KG\))?\s*[:\-]?\s*([0-9.]+,[0-9]{3,5})/i]); if(values.peso_liquido.value&&!/kg$/i.test(values.peso_liquido.value))values.peso_liquido.value+=' kg';
  set('valor_total_nota',[/VALOR\s+TOTAL\s+DA\s+NOTA\s*[:\-]?\s*(?:R\$\s*)?([0-9.]+,[0-9]{2})/i,/TOTAL\s+(?:DA\s+)?NOTA\s*[:\-]?\s*(?:R\$\s*)?([0-9.]+,[0-9]{2})/i]); if(values.valor_total_nota.value&&!/^R\$/i.test(values.valor_total_nota.value))values.valor_total_nota.value=`R$ ${values.valor_total_nota.value}`;
  return {process_type:processType,fields:keys.map(key=>({key,label:labels[key],...values[key]})),pages:results.reduce((a,r)=>a+r.total,0),filename:zipName,ocr_pages:pages.filter(p=>p.ocr).map(p=>`${p.filename} p.${p.page}`),documents:[`${results.length} PDF(s) dentro do ZIP`]};
}
async function analyzeZip(file:File):Promise<Analysis> {
  const zip=await JSZip.loadAsync(await file.arrayBuffer()); const entries=Object.values(zip.files).filter(e=>!e.dir&&e.name.toLowerCase().endsWith('.pdf'));
  if(!entries.length) throw new Error('Nenhum PDF foi encontrado dentro do arquivo ZIP.');
  const results=await mapLimit(entries,3,async entry=>readPdfData(await entry.async('uint8array'),'ZIP PDF',entry.name));
  return analyzeZipResults(results,file.name);
}

export default function App(){
  const docRef=useRef<HTMLInputElement>(null),nfRef=useRef<HTMLInputElement>(null),zipRef=useRef<HTMLInputElement>(null);
  const [docFile,setDocFile]=useState<File|null>(null),[nfFile,setNfFile]=useState<File|null>(null),[zipFile,setZipFile]=useState<File|null>(null),[analysis,setAnalysis]=useState<Analysis|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const validPdf=(f:File)=>{if(f.type!=='application/pdf'&&!f.name.toLowerCase().endsWith('.pdf')){setError('Somente arquivos PDF são aceitos nessa área.');return false}if(f.size>25*1024*1024){setError('Cada PDF deve ter no máximo 25 MB.');return false}return true};
  const validZip=(f:File)=>{if(!f.name.toLowerCase().endsWith('.zip')){setError('Selecione um arquivo .zip.');return false}if(f.size>100*1024*1024){setError('O ZIP deve ter no máximo 100 MB.');return false}return true};
  const analyze=async()=>{if(!docFile&&!nfFile&&!zipFile)return;setBusy(true);setError('');try{if(zipFile){setAnalysis(await analyzeZip(zipFile));return}const tasks:Promise<ReadResult>[]=[];if(docFile)tasks.push(readPdf(docFile,'DOC COMPLETO'));if(nfFile)tasks.push(readPdf(nfFile,'NF FISCAL'));setAnalysis(analyzeDocuments(await Promise.all(tasks)))}catch(e){setError(e instanceof Error?e.message:'Não foi possível analisar os arquivos.')}finally{setBusy(false)}};
  const update=(key:string,value:string)=>setAnalysis(a=>a?({...a,fields:a.fields.map(f=>f.key===key?{...f,value,edited:true,confidence:'high'}:f)}):a);
  const report=useMemo(()=>analysis?analysis.fields.map(f=>`${f.label}: ${f.value??'Não localizado'}`).join('\n'):'',[analysis]); const found=analysis?.fields.filter(f=>f.value).length??0;
  const picker=(title:string,file:File|null,setter:(f:File|null)=>void,ref:React.RefObject<HTMLInputElement>,icon:any,accept:string,onPick:(f:File)=>boolean)=><div className="upload" onClick={()=>ref.current?.click()}><input ref={ref} type="file" accept={accept} hidden onChange={e=>{const f=e.target.files?.[0];if(f&&onPick(f)){setter(f);setAnalysis(null)}}}/><div className="upload-icon">{icon}</div><h2>{file?file.name:title}</h2><p>{file?'Arquivo pronto para análise':'clique para selecionar'}</p>{file&&<button className="icon-btn" onClick={e=>{e.stopPropagation();setter(null)}}><X/></button>}</div>;

  return <div className="app"><div className="grid-bg"/><header><div className="brand"><div className="brand-mark"><Sparkles size={19}/></div><div><strong>Conclusão de Processos</strong><span>Extração e conferência cruzada</span></div></div><div className="header-status"><span className="live-dot"/> Sistema operacional</div></header><main>{!analysis?<section className="hero"><div className="eyebrow"><Zap size={15}/> PDFs individuais ou pacote ZIP</div><h1>Escolha o modo de análise.<br/><em>Os mesmos campos, regras diferentes.</em></h1><p className="lead">DOC COMPLETO + NF mantém todas as regras específicas já validadas. Na área ZIP, os padrões anteriores não são usados: todos os PDFs internos são abertos e os campos necessários são procurados ao longo de todo o conteúdo.</p><div className="dual-upload">{picker('DOC COMPLETO',docFile,setDocFile,docRef,<FileText/>,'application/pdf,.pdf',f=>{if(!validPdf(f))return false;setZipFile(null);return true})}{picker('NF Fiscal (opcional)',nfFile,setNfFile,nfRef,<FilePlus2/>,'application/pdf,.pdf',f=>{if(!validPdf(f))return false;setZipFile(null);return true})}</div><div style={{marginTop:16}}>{picker('Pacote .ZIP com PDFs',zipFile,setZipFile,zipRef,<Archive/>,'.zip,application/zip',f=>{if(!validZip(f))return false;setDocFile(null);setNfFile(null);return true})}</div>{error&&<div className="error"><AlertTriangle size={18}/>{error}</div>}{(docFile||nfFile||zipFile)&&<button className="primary" onClick={analyze} disabled={busy}>{busy?<><Loader2 className="spin"/> {zipFile?'Abrindo ZIP e lendo PDFs...':'Lendo e cruzando PDFs...'}</>:<>Analisar Processo <ChevronRight/></>}</button>}</section>:<section className="results"><div className="result-head"><div><div className="eyebrow"><Check size={15}/> Análise concluída</div><h1>Informações necessárias</h1><p>{analysis.documents.join(' + ')} · {found}/{analysis.fields.length} campos localizados</p></div><button className="secondary" onClick={()=>setAnalysis(null)}><RotateCcw size={16}/> Nova análise</button></div><div className="metrics"><div className="metric"><span>Operação</span><b className="type">{analysis.process_type}</b></div><div className="metric"><span>Campos encontrados</span><b>{found}<small>/{analysis.fields.length}</small></b></div><div className="metric"><span>Escopo</span><b>{zipFile?'Todos os PDFs do ZIP':'Todas as páginas'}</b></div></div><div className="table"><div className="table-head"><span>Campo</span><span>Valor extraído</span><span>Confiança</span><span>Fonte / Conferência</span><span/></div>{analysis.fields.map(f=><div className="row" key={f.key}><div><b>{f.label}</b>{f.edited&&<small className="edited">Editado manualmente</small>}</div><div>{f.value===null?<span className="not-found">Não localizado no documento</span>:<input value={f.value} onChange={e=>update(f.key,e.target.value)}/>}</div><div><span className={`confidence ${f.confidence}`}>{f.confidence==='high'?'✓':f.confidence==='medium'?'⚠':'?'} {f.confidence==='high'?'Alta confiança':f.confidence==='medium'?'Revisar':'Baixa confiança'}</span></div><div className="source">{f.source}</div><button className="copy" onClick={()=>void navigator.clipboard?.writeText(f.value??'')}><Clipboard size={15}/></button></div>)}</div><div className="integrity"><div className="shield">✓</div><div><b>{zipFile?'Modo ZIP independente':'Leitura otimizada sem reduzir o escopo'}</b><span>{zipFile?'O ZIP é analisado sem as posições fixas de DOC COMPLETO/NF. Cada resultado mostra de qual PDF interno e página veio a informação.':'As regras específicas já validadas continuam ativas para DOC COMPLETO + NF.'}</span></div><button className="secondary" onClick={()=>void navigator.clipboard?.writeText(report)}><Clipboard size={16}/> Copiar relatório</button></div></section>}</main><footer><span>CONCLUSÃO DE PROCESSOS · foco em precisão</span><span>PDF + ZIP</span></footer></div>;
}