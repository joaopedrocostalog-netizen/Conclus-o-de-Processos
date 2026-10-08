import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { createWorker } from 'tesseract.js';

GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();

export const KEMIN_REPORT_FIELDS=Object.freeze([
  'Cliente',
  'Tipo Documento',
  'Remetente / Exportador',
  'Nº BL / AWB',
  'Local de Armazenagem',
  'Ref. do Cliente',
  'Nº Documento',
  'Destinatário / Importador',
  'Operação Marítima',
  'Agência Marítima',
  'CNPJ do Cliente / Importador',
  'Contêineres',
  'Peso Líquido',
  'Valor Total da Nota'
] as const);

export type KeminReportFieldLabel=typeof KEMIN_REPORT_FIELDS[number];
export type KeminAnalysisField={label:KeminReportFieldLabel;value:string;source:string;confidence:'Alta'|'Média'|'Baixa'};
export type KeminAnalysisSnapshot={client:'KEMIN';processType:string;summary:string;fields:KeminAnalysisField[];found:number;total:number};

type PdfPage={filename:string;page:number;rows:string[];text:string;flatText:string;ocr:boolean};
type Pick={value:string|null;source:string;confidence:'Alta'|'Média'|'Baixa'};

const clean=(value:string)=>value.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const one=(value:string)=>clean(value).replace(/\n/g,' ').trim();
const empty=(why:string):Pick=>({value:null,source:why,confidence:'Baixa'});
const pdfSource=(p:PdfPage,note:string)=>`PDF · ${p.filename} · página ${p.page} · ${note}`;
const norm=(value:string)=>value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();

let ocrWorkerPromise:Promise<any>|null=null;
function getOcrWorker(){return ocrWorkerPromise||(ocrWorkerPromise=createWorker('eng'))}

function itemsToRows(items:any[]):string[]{
  const cells=items.filter(raw=>raw&&'str' in raw&&String(raw.str||'').trim()).map((raw:any)=>({str:String(raw.str||'').trim(),x:Number(raw.transform?.[4]||0),y:Number(raw.transform?.[5]||0)}));
  const groups:Array<{y:number;cells:typeof cells}>=[];
  for(const cell of cells){let group=groups.find(g=>Math.abs(g.y-cell.y)<=2.8);if(!group){group={y:cell.y,cells:[]};groups.push(group)}group.cells.push(cell)}
  return groups.sort((a,b)=>b.y-a.y).map(g=>g.cells.sort((a,b)=>a.x-b.x).map(c=>c.str).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean);
}

async function ocrPage(page:any){
  const viewport=page.getViewport({scale:2});
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext('2d');if(!ctx)return{rows:[] as string[],text:''};
  await page.render({canvas,canvasContext:ctx,viewport}).promise;
  const worker=await getOcrWorker(),result=await worker.recognize(canvas),text=clean(String(result?.data?.text||''));
  return{rows:text.split(/\r?\n/).map((row:string)=>clean(row)).filter(Boolean),text};
}

async function readPdf(file:File):Promise<PdfPage[]>{
  const pdf=await getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  const pages:PdfPage[]=[];
  for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
    const page=await pdf.getPage(pageNumber),content=await page.getTextContent(),items=content.items as any[];
    let pageRows=itemsToRows(items),flat=clean(items.filter(raw=>raw&&'str' in raw).map((raw:any)=>String(raw.str||'').trim()).filter(Boolean).join(' ')),ocr=false;
    if(flat.replace(/\s/g,'').length<40){
      try{const scanned=await ocrPage(page);if(scanned.text){pageRows=scanned.rows;flat=scanned.text;ocr=true}}catch{}
    }
    pages.push({filename:file.name,page:pageNumber,rows:pageRows,text:clean(pageRows.join('\n')),flatText:flat,ocr});
  }
  return pages;
}

async function readPdfs(files:File[]){
  const out:PdfPage[]=[];
  for(const file of files)out.push(...await readPdf(file));
  return out;
}

const all=(p:PdfPage)=>one(`${p.text} ${p.flatText}`);
const rows=(p:PdfPage)=>p.rows.map(one).filter(Boolean);
const isNfe=(p:PdfPage)=>/\bDANFE\b|NOTA FISCAL ELETR[OÔ]NICA|VALOR TOTAL DA NOTA|CHAVE DE ACESSO/i.test(all(p));
const isDuimp=(p:PdfPage)=>/EXTRATO\s+DA\s+DUIMP|SITUA[CÇ][AÃ]O\s+DA\s+DUIMP|NOME\s+DO\s+IMPORTADOR|PESO\s+L[IÍ]QUIDO\s*\(KG\)/i.test(all(p));
const isBl=(p:PdfPage)=>/BILL\s+OF\s+LADING|SHIPPER|CONSIGNEE|VESSEL\s*\/\s*VOYAGE/i.test(all(p));
const nfePages=(pages:PdfPage[])=>pages.filter(isNfe);
const duimpPages=(pages:PdfPage[])=>pages.filter(isDuimp);

function capture(text:string,pattern:RegExp){const m=text.match(pattern);return m?.[1]?one(m[1]):null}
function stripTrailingDate(value:string){return value.replace(/\s+\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?\s*$/,'').trim()}
function parsePtBrNumber(value:string){const n=Number(value.replace(/\./g,'').replace(',','.'));return Number.isFinite(n)?n:null}
function formatPtBr(value:number,decimals:number){return new Intl.NumberFormat('pt-BR',{minimumFractionDigits:decimals,maximumFractionDigits:decimals,useGrouping:true}).format(value)}

function clientName(pages:PdfPage[]):Pick{
  for(const p of duimpPages(pages)){
    const value=capture(all(p),/Nome\s+do\s+importador\s*:\s*(.+?)(?=\s+(?:Endere[cç]o\s+do\s+importador|Informa[cç][oõ]es\s+Complementares|CNPJ\s+do\s+importador|Tipo\s+de\s+importador|$))/i);
    if(value)return{value,source:pdfSource(p,'Nome do importador'),confidence:'Alta'};
  }
  for(const p of nfePages(pages)){
    const rs=rows(p),marker=rs.findIndex(r=>/IDENTIFICA[CÇ][AÃ]O\s+DO\s+EMITENTE/i.test(r));
    if(marker>=0)for(const r of rs.slice(marker+1,marker+8))if(/\bLTDA\b|\bS\/A\b|\bSA\b/i.test(r)&&!/CNPJ|ENDERE[CÇ]O|DANFE/i.test(r))return{value:stripTrailingDate(r),source:pdfSource(p,'Identificação do emitente'),confidence:'Média'};
  }
  return empty('Cliente não localizado dinamicamente nos PDFs enviados.');
}

function documentType(pages:PdfPage[]):Pick{
  for(const p of duimpPages(pages))return{value:'DUIMP',source:pdfSource(p,'tipo identificado pelo Extrato da DUIMP'),confidence:'Alta'};
  return empty('Tipo de documento não identificado nos PDFs.');
}

function exporter(pages:PdfPage[]):Pick{
  for(const p of nfePages(pages)){
    const rs=rows(p),marker=rs.findIndex(r=>/DESTINAT[ÁA]RIO\s*\/\s*REMETENTE/i.test(r));if(marker<0)continue;
    const block=rs.slice(marker+1,marker+12);
    const label=block.findIndex(r=>/NOME\s*\/\s*RAZ[AÃ]O\s+SOCIAL/i.test(r));
    const candidates=(label>=0?block.slice(label+1,label+5):block).map(stripTrailingDate);
    for(const value of candidates){
      if(!value||/^(CNPJ|CPF|DATA|ENDERE[CÇ]O|BAIRRO|MUNIC[IÍ]PIO|FONE|CEP|UF|INSCRI[CÇ][AÃ]O|FATURA)\b/i.test(value))continue;
      if(value.length>4)return{value,source:pdfSource(p,'DESTINATÁRIO/REMETENTE · NOME/RAZÃO SOCIAL'),confidence:'Alta'};
    }
  }
  for(const p of pages.filter(isBl)){
    const value=capture(all(p),/SHIPPER(?:\s*\([^)]*\))?\s*[:\-]?\s*(.+?)(?=\s+(?:CONSIGNEE|JOB\s*NO|BILL\s+OF\s+LADING))/i);
    if(value)return{value:value.split(/\s{2,}|\n/)[0].trim(),source:pdfSource(p,'SHIPPER'),confidence:'Média'};
  }
  return empty('Remetente / Exportador não localizado nos PDFs.');
}

function blNumber(pages:PdfPage[]):Pick{
  const patterns=[
    /BILL\s*OF\s*LADING\s*(?:NO\.?|NUMBER)\s*[:#\-]?\s*([A-Z0-9-]{5,30})/i,
    /B\s*\/\s*L\s*(?:NO\.?|NUMBER)\s*[:#\-]?\s*([A-Z0-9-]{5,30})/i,
    /HBL\s*(?:NO\.?|NUMBER)?\s*[:#\-]?\s*([A-Z0-9-]{5,30})/i
  ];
  for(const p of pages.filter(isBl)){
    const text=all(p);
    for(const pattern of patterns){
      const m=text.match(pattern);
      if(m?.[1])return{value:m[1].trim(),source:pdfSource(p,'BILL OF LADING NO.'),confidence:'Alta'};
    }
    const rs=rows(p);
    for(let i=0;i<rs.length;i++){
      if(!/BILL\s*OF\s*LADING\s*(?:NO\.?|NUMBER)/i.test(rs[i]))continue;
      const same=rs[i].match(/(?:NO\.?|NUMBER)\s*[:#\-]?\s*([A-Z0-9-]{5,30})/i);
      if(same?.[1])return{value:same[1],source:pdfSource(p,'BILL OF LADING NO.'),confidence:'Alta'};
      const next=rs[i+1]?.match(/^\s*([A-Z0-9-]{5,30})\s*$/i);
      if(next?.[1])return{value:next[1],source:pdfSource(p,'BILL OF LADING NO.'),confidence:'Alta'};
    }
  }
  return empty('Nº BL / AWB não localizado no BL.');
}

function storage(pages:PdfPage[]):Pick{
  for(const p of duimpPages(pages)){
    const value=capture(all(p),/Unidade\s+de\s+entrada\s*\/\s*descarga\s*:\s*(.+?)(?=\s+(?:Embalagem|Hist[oó]rico|Peso\s+Bruto|Peso\s+L[ií]quido|$))/i);
    if(value)return{value,source:pdfSource(p,'Unidade de entrada/descarga'),confidence:'Alta'};
  }
  return empty('Local de Armazenagem não localizado no Extrato da DUIMP.');
}

function clientRef(pages:PdfPage[]):Pick{
  for(const p of duimpPages(pages)){
    const text=all(p);
    const imp=text.match(/(?:^|[|\s])IMP\s*:\s*([A-Z0-9./_-]+)/i);
    if(imp?.[1])return{value:imp[1],source:pdfSource(p,'Informações Complementares · IMP'),confidence:'Alta'};
    const ref=text.match(/REF\.?\s*CLIENTE\s*:\s*([A-Z0-9./_-]+)/i);
    if(ref?.[1])return{value:ref[1],source:pdfSource(p,'Informações Complementares · REF CLIENTE'),confidence:'Média'};
  }
  return empty('Ref. do Cliente não localizada no Extrato da DUIMP.');
}

function duimpNumberFromPage(p:PdfPage){
  const text=all(p);
  return text.match(/Extrato\s+da\s+Duimp\s+([0-9]{2}BR[0-9]{8,14}(?:-[0-9])?)/i)?.[1]
    ||text.match(/\b([0-9]{2}BR[0-9]{8,14}(?:-[0-9])?)\b/i)?.[1]
    ||null;
}

function documentNumber(pages:PdfPage[]):Pick{
  for(const p of duimpPages(pages)){
    const value=duimpNumberFromPage(p);
    if(value)return{value:value.toUpperCase(),source:pdfSource(p,'título do Extrato da DUIMP'),confidence:'Alta'};
  }
  return empty('Nº Documento não localizado no Extrato da DUIMP.');
}

function importer(pages:PdfPage[]):Pick{
  const pick=clientName(pages);
  if(pick.value)return{...pick,source:pick.source.replace('Identificação do emitente','identificação do importador/cliente')};
  return empty('Destinatário / Importador não localizado nos PDFs.');
}

function operation(pages:PdfPage[]):Pick{
  for(const p of pages){const text=all(p);if(/ICMS\s*-?\s*importa[cç][aã]o|EXTRATO\s+DA\s+DUIMP|\bDUIMP\b/i.test(text))return{value:'Importação',source:pdfSource(p,'operação identificada pelos documentos do processo'),confidence:'Alta'}}
  return empty('Operação Marítima não identificada nos PDFs.');
}

function shippingAgency(pages:PdfPage[]):Pick{
  for(const p of pages.filter(isBl)){
    const text=all(p);
    const vesselVoyage=capture(text,/VESSEL\s*\/\s*VOYAGE\s*[:\-]?\s*(.+?)(?=\s+(?:PORT\s+OF\s+LOADING|PORT\s+OF\s+DISCHARGE|PLACE\s+OF\s+DELIVERY|$))/i);
    if(vesselVoyage){
      const vessel=vesselVoyage.split(/\s*\/\s*/)[0]?.trim();
      if(vessel)return{value:vessel,source:pdfSource(p,'VESSEL / VOYAGE · navio'),confidence:'Alta'};
    }
    const rs=rows(p);
    for(let i=0;i<rs.length;i++){
      if(!/VESSEL\s*\/\s*VOYAGE/i.test(rs[i]))continue;
      const inline=rs[i].replace(/^.*?VESSEL\s*\/\s*VOYAGE\s*[:\-]?\s*/i,'').trim();
      const candidate=(inline||rs[i+1]||'').split(/\s*\/\s*/)[0].trim();
      if(candidate&&!/PORT\s+OF/i.test(candidate))return{value:candidate,source:pdfSource(p,'VESSEL / VOYAGE · navio'),confidence:'Alta'};
    }
  }
  return empty('Navio não localizado no campo VESSEL / VOYAGE do BL.');
}

function importerCnpj(pages:PdfPage[]):Pick{
  const cnpj=/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/;
  for(const p of nfePages(pages)){
    const text=all(p),header=text.split(/DESTINAT[ÁA]RIO\s*\/\s*REMETENTE/i)[0]||text;
    const matches=[...header.matchAll(new RegExp(cnpj.source,'g'))].map(m=>m[0]);
    if(matches.length)return{value:matches[0],source:pdfSource(p,'CNPJ do emitente/importador'),confidence:'Alta'};
  }
  for(const p of duimpPages(pages)){
    const m=all(p).match(/CNPJ\s+do\s+importador\s*:\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i);
    if(m?.[1])return{value:m[1],source:pdfSource(p,'CNPJ do importador'),confidence:'Média'};
  }
  return empty('CNPJ do Cliente / Importador não localizado nos PDFs.');
}

function containers(pages:PdfPage[]):Pick{
  const found:Array<{value:string;page:PdfPage}>=[];
  for(const p of duimpPages(pages)){
    const text=all(p);
    const containerBlock=text.match(/CONTAINERS?\s*:\s*([^|\n]+?)(?=\s*[|=]{2,}|\s+VALOR\s+EM\s+MOEDA|$)/i)?.[1]||'';
    for(const m of containerBlock.matchAll(/\b([A-Z]{4}\d{7})\b/g))found.push({value:m[1].toUpperCase(),page:p});
  }
  if(!found.length){
    for(const p of pages.filter(isBl))for(const m of all(p).matchAll(/\b([A-Z]{4}\d{7})\b/g))found.push({value:m[1].toUpperCase(),page:p});
  }
  const unique=[...new Map(found.map(item=>[item.value,item])).values()];
  if(!unique.length)return empty('Contêineres não localizados nos PDFs.');
  const source=unique.length===1
    ?pdfSource(unique[0].page,duimpPages(pages).includes(unique[0].page)?'CONTAINERS':'contêiner no BL')
    :`PDFs · ${unique.map(item=>`${item.page.filename} · página ${item.page.page} · ${item.value}`).join(' + ')} · CONTAINERS`;
  return{value:unique.map(item=>item.value).join(', '),source,confidence:'Alta'};
}

function netWeight(pages:PdfPage[]):Pick{
  const found:Array<{key:string;value:number;display:string;page:PdfPage}>=[];
  for(const p of duimpPages(pages)){
    const text=all(p),m=text.match(/Peso\s+L[ií]quido\s*\(kg\)\s*:\s*([\d.]+,\d{3,6})/i);if(!m?.[1])continue;
    const value=parsePtBrNumber(m[1]);if(value===null)continue;
    const doc=duimpNumberFromPage(p),key=doc?norm(doc):`${norm(p.filename)}:${m[1]}`;
    found.push({key,value,display:m[1],page:p});
  }
  const unique=[...new Map(found.map(item=>[item.key,item])).values()];
  if(!unique.length)return empty('Peso Líquido não localizado no Extrato da DUIMP.');
  const total=unique.reduce((sum,item)=>sum+item.value,0);
  const source=unique.length===1?pdfSource(unique[0].page,'Peso Líquido (kg)'):`Soma de ${unique.length} Extratos DUIMP únicos · ${unique.map(item=>`${item.page.filename} · página ${item.page.page} · ${item.display}`).join(' + ')}`;
  return{value:formatPtBr(total,4),source,confidence:'Alta'};
}

function nfeIdentity(p:PdfPage,value:string){
  const text=all(p);
  const access=text.match(/CHAVE\s+DE\s+ACESSO(?:\s+DA\s+NF-?E)?\s*[:\-]?\s*([\d\s]{44,80})/i)?.[1]?.replace(/\D/g,'').slice(0,44);
  if(access?.length===44)return`KEY:${access}`;
  const number=text.match(/N[º°]\s*([\d.]{3,20})/i)?.[1]?.replace(/\D/g,'')||'';
  const series=text.match(/S[EÉ]RIE\s*[:\-]?\s*(\d+)/i)?.[1]||'';
  return`NF:${number}:${series}:${value}`;
}

function noteValue(pages:PdfPage[]):Pick{
  const found:Array<{key:string;value:number;display:string;page:PdfPage}>=[];
  for(const p of nfePages(pages)){
    const rs=rows(p),marker=rs.findIndex(r=>/VALOR\s+TOTAL\s+DA\s+NOTA/i.test(r));if(marker<0)continue;
    const candidates:string[]=[];
    for(const r of rs.slice(marker,marker+6))for(const m of r.matchAll(/\b\d{1,3}(?:\.\d{3})*,\d{2}\b/g))candidates.push(m[0]);
    if(!candidates.length)continue;
    const ranked=candidates.map(display=>({display,value:parsePtBrNumber(display)})).filter((item):item is {display:string;value:number}=>item.value!==null).sort((a,b)=>b.value-a.value);
    if(!ranked.length)continue;
    const hit=ranked[0],key=nfeIdentity(p,hit.display);found.push({key,value:hit.value,display:hit.display,page:p});
  }
  const unique=[...new Map(found.map(item=>[item.key,item])).values()];
  if(!unique.length)return empty('Valor Total da Nota não localizado nas NFs.');
  const total=unique.reduce((sum,item)=>sum+item.value,0);
  const source=unique.length===1?pdfSource(unique[0].page,'VALOR TOTAL DA NOTA'):`Soma de ${unique.length} NFs únicas · ${unique.map(item=>`${item.page.filename} · página ${item.page.page} · R$ ${item.display}`).join(' + ')}`;
  return{value:formatPtBr(total,2),source,confidence:'Alta'};
}

function field(label:KeminReportFieldLabel,pick:Pick):KeminAnalysisField{return{label,value:pick.value||'—',source:pick.source,confidence:pick.confidence}}

export async function runKeminAnalysis(files:File[]):Promise<KeminAnalysisSnapshot>{
  if(!files.length)throw new Error('Selecione pelo menos um PDF da KEMIN.');
  const pages=await readPdfs(files);
  const picks:Record<KeminReportFieldLabel,Pick>={
    'Cliente':clientName(pages),
    'Tipo Documento':documentType(pages),
    'Remetente / Exportador':exporter(pages),
    'Nº BL / AWB':blNumber(pages),
    'Local de Armazenagem':storage(pages),
    'Ref. do Cliente':clientRef(pages),
    'Nº Documento':documentNumber(pages),
    'Destinatário / Importador':importer(pages),
    'Operação Marítima':operation(pages),
    'Agência Marítima':shippingAgency(pages),
    'CNPJ do Cliente / Importador':importerCnpj(pages),
    'Contêineres':containers(pages),
    'Peso Líquido':netWeight(pages),
    'Valor Total da Nota':noteValue(pages)
  };
  const fields=KEMIN_REPORT_FIELDS.map(label=>field(label,picks[label])),found=fields.filter(item=>item.value!=='—').length;
  const processType=picks['Operação Marítima'].value||'Não identificado';
  return{client:'KEMIN',processType,summary:`${found}/${fields.length} campos localizados nos PDFs enviados`,fields,found,total:fields.length};
}
