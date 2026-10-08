import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { createWorker } from 'tesseract.js';

GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();

export const CEVA_REPORT_FIELDS=Object.freeze([
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

export type CevaReportFieldLabel=typeof CEVA_REPORT_FIELDS[number];
export type CevaAnalysisField={label:CevaReportFieldLabel;value:string;source:string;confidence:'Alta'|'Média'|'Baixa'};
export type CevaAnalysisSnapshot={client:'CEVA';processType:string;summary:string;fields:CevaAnalysisField[];found:number;total:number};

type PdfPage={filename:string;page:number;rows:string[];text:string;flatText:string;ocr:boolean};
type Pick={value:string|null;source:string;confidence:'Alta'|'Média'|'Baixa'};

const clean=(value:string)=>value.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const one=(value:string)=>clean(value).replace(/\n/g,' ').trim();
const norm=(value:string)=>value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
const empty=(why:string):Pick=>({value:null,source:why,confidence:'Baixa'});
const source=(p:PdfPage,note:string)=>`PDF · ${p.filename} · página ${p.page} · ${note}`;

let workerPromise:Promise<any>|null=null;
function getWorker(){return workerPromise||(workerPromise=createWorker('eng+por'))}

function itemsToRows(items:any[]):string[]{
  const cells=items.filter(raw=>raw&&'str' in raw&&String(raw.str||'').trim()).map((raw:any)=>({str:String(raw.str||'').trim(),x:Number(raw.transform?.[4]||0),y:Number(raw.transform?.[5]||0)}));
  const groups:Array<{y:number;cells:typeof cells}>=[];
  for(const cell of cells){let group=groups.find(g=>Math.abs(g.y-cell.y)<=2.8);if(!group){group={y:cell.y,cells:[]};groups.push(group)}group.cells.push(cell)}
  return groups.sort((a,b)=>b.y-a.y).map(g=>g.cells.sort((a,b)=>a.x-b.x).map(c=>c.str).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean);
}

async function ocrPage(page:any){
  const viewport=page.getViewport({scale:2});
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext('2d');if(!ctx)return'';
  await page.render({canvas,canvasContext:ctx,viewport}).promise;
  const worker=await getWorker();
  const result=await worker.recognize(canvas,{}, {text:true});
  return clean(String(result?.data?.text||''));
}

async function readPdf(file:File):Promise<PdfPage[]>{
  const pdf=await getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  const pages:PdfPage[]=[];
  for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
    const page=await pdf.getPage(pageNumber),content=await page.getTextContent(),items=content.items as any[];
    let rows=itemsToRows(items),flat=clean(items.filter(raw=>raw&&'str' in raw).map((raw:any)=>String(raw.str||'').trim()).filter(Boolean).join(' ')),ocr=false;
    if(flat.replace(/\s/g,'').length<60){
      try{const scanned=await ocrPage(page);if(scanned){flat=scanned;rows=scanned.split(/\r?\n/).map(clean).filter(Boolean);ocr=true}}catch{}
    }
    pages.push({filename:file.name,page:pageNumber,rows,text:clean(rows.join('\n')),flatText:flat,ocr});
  }
  return pages;
}
async function readPdfs(files:File[]){const out:PdfPage[]=[];for(const file of files)out.push(...await readPdf(file));return out}

const all=(p:PdfPage)=>one(`${p.text} ${p.flatText}`);
const isNfe=(p:PdfPage)=>/\bDANFE\b|NOTA FISCAL ELETR[OÔ]NICA|VALOR TOTAL DA NOTA|CHAVE DE ACESSO/i.test(all(p));
const isDuimp=(p:PdfPage)=>/EXTRATO\s+DA\s+DUIMP|NOME\s+DO\s+IMPORTADOR|SITUA[CÇ][AÃ]O\s+DA\s+DUIMP/i.test(all(p));
const isBl=(p:PdfPage)=>/BILL\s+OF\s+LADING|B\/?L-?NO|SHIPPER|CONSIGNEE|VESSEL|VOYAGE/i.test(all(p));
const nfs=(pages:PdfPage[])=>pages.filter(isNfe);
const duimps=(pages:PdfPage[])=>pages.filter(isDuimp);
const bls=(pages:PdfPage[])=>pages.filter(isBl);

function capture(text:string,pattern:RegExp){const m=text.match(pattern);return m?.[1]?one(m[1]):null}
function brNumber(value:string){const n=Number(value.replace(/\./g,'').replace(',','.'));return Number.isFinite(n)?n:null}
function formatBr(value:number,decimals:number){return new Intl.NumberFormat('pt-BR',{minimumFractionDigits:decimals,maximumFractionDigits:decimals}).format(value)}

function client(pages:PdfPage[]):Pick{
  for(const p of nfs(pages)){
    const text=all(p),start=text.search(/TRANSPORTADOR\s*\/\s*VOLUMES\s+TRANSPORTADOS/i);
    if(start>=0){
      const block=text.slice(start,start+900);
      const m=block.match(/RAZ[AÃ]O\s+SOCIAL\s+(.+?)(?=\s+(?:FRETE\s+POR\s+CONTA|C[ÓO]DIGO\s+ANTT|CNPJ\/CPF|ENDERE[CÇ]O))/i);
      if(m?.[1])return{value:one(m[1]),source:source(p,'Transportador / Razão Social'),confidence:'Alta'};
    }
  }
  return empty('Cliente não localizado no quadro Transportador da NF.');
}
function docType(pages:PdfPage[]):Pick{for(const p of duimps(pages))return{value:'DUIMP',source:source(p,'Extrato da DUIMP'),confidence:'Alta'};return empty('Tipo Documento não localizado.')}
function exporter(pages:PdfPage[]):Pick{
  for(const p of nfs(pages)){
    const value=capture(all(p),/DESTINATARIO\s*\/\s*REMETENTE[\s\S]{0,220}?NOME\s*\/\s*RAZ[AÃ]O\s+SOCIAL\s+(.+?)(?=\s+(?:CNPJ\/CPF|DATA\s+DE\s+EMISS[AÃ]O|ENDERE[CÇ]O))/i);
    if(value)return{value,source:source(p,'DESTINATÁRIO/REMETENTE · NOME/RAZÃO SOCIAL'),confidence:'Alta'};
  }
  for(const p of duimps(pages)){
    const value=capture(all(p),/C[oó]digo\s+do\s+Exportador\s+Estrangeiro\s*:\s*(?:OPE_\d+\s*-\s*)?(.+?)(?=\s+(?:Vers[aã]o|Endere[cç]o|Dados\s+da\s+Mercadoria))/i);
    if(value)return{value,source:source(p,'Exportador Estrangeiro'),confidence:'Alta'};
  }
  for(const p of bls(pages)){
    const value=capture(all(p),/SHIPPER(?:\s*\([^)]*\))?\s*[:\-]?\s*(.+?)(?=\s+(?:CONSIGNEE|Carrier|B\/L|Bill\s+of\s+Lading))/i);
    if(value)return{value,source:source(p,'SHIPPER'),confidence:'Média'};
  }
  return empty('Remetente / Exportador não localizado.');
}
function blNumber(pages:PdfPage[]):Pick{
  for(const p of duimps(pages)){const m=all(p).match(/CONHECIMENTO\.*\s*:\s*([A-Z0-9-]{8,})/i);if(m?.[1])return{value:m[1],source:source(p,'CONHECIMENTO'),confidence:'Alta'}}
  for(const p of bls(pages)){
    const text=all(p);
    const m=text.match(/B\/?L-?NO\.?\s*[:#-]?\s*([A-Z0-9-]{8,})/i)||text.match(/BILL\s+OF\s+LADING(?:\s*(?:NO\.?|NUMBER))?\s*[:#-]?\s*([A-Z0-9-]{8,})/i);
    if(m?.[1])return{value:m[1],source:source(p,'B/L-No.'),confidence:'Alta'};
  }
  return empty('Nº BL / AWB não localizado.');
}
function storage(pages:PdfPage[]):Pick{
  for(const p of duimps(pages)){const v=capture(all(p),/Recinto\s*:\s*(.+?)(?=\s+(?:Identifica[cç][aã]o\s+da\s+carga|Dados\s+da\s+Carga|Pa[ií]s\s+de\s+Proced[eê]ncia|$))/i);if(v&&v!=='-')return{value:v,source:source(p,'Recinto'),confidence:'Alta'}}
  return empty('Local de Armazenagem não localizado no campo Recinto.');
}
function refClient(pages:PdfPage[]):Pick{
  for(const p of duimps(pages)){
    const text=all(p),m=text.match(/REF\.?\s+IMPORTADOR\.*\s*:\s*([A-Z0-9./-]+)/i)||text.match(/REF\.?\s+REPRESENTANTE\.*\s*:\s*([A-Z0-9./-]+)/i);
    if(m?.[1])return{value:m[1],source:source(p,m[0].split(':')[0].trim()),confidence:'Alta'};
  }
  for(const p of nfs(pages)){const m=all(p).match(/S\/REF\.?\s*([A-Z0-9./-]+)/i);if(m?.[1])return{value:m[1],source:source(p,'S/REF.'),confidence:'Média'}}
  return empty('Ref. do Cliente não localizada.');
}
function documentNumber(pages:PdfPage[]):Pick{
  for(const p of duimps(pages)){const m=all(p).match(/Extrato\s+da\s+Duimp\s+([0-9]{2}BR[0-9-]+)/i);if(m?.[1])return{value:m[1],source:source(p,'título do Extrato da DUIMP'),confidence:'Alta'}}
  return empty('Nº Documento não localizado.');
}
function importer(pages:PdfPage[]):Pick{
  for(const p of duimps(pages)){const v=capture(all(p),/Nome\s+do\s+importador\s*:\s*(.+?)(?=\s+(?:Endere[cç]o\s+do\s+importador|Informa[cç][oõ]es\s+Complementares|CNPJ\s+do\s+importador|$))/i);if(v)return{value:v,source:source(p,'Nome do importador'),confidence:'Alta'}}
  return empty('Destinatário / Importador não localizado.');
}
function operation(pages:PdfPage[]):Pick{for(const p of duimps(pages))return{value:'Importação',source:source(p,'operação identificada pelo Extrato da DUIMP'),confidence:'Alta'};return empty('Operação não identificada.')}
function vessel(pages:PdfPage[]):Pick{
  for(const p of duimps(pages)){const v=capture(all(p),/(?:VE[IÍ]CULO|NAVIO\s+DE\s+EMBARQUE)\.*\s*:\s*(.+?)(?=\s+(?:DATA\s+DA\s+CHEGADA|CONTEINERES|$))/i);if(v)return{value:v,source:source(p,'VEÍCULO / Navio'),confidence:'Alta'}}
  for(const p of bls(pages)){const v=capture(all(p),/(?:VESSEL(?:\s+NAME)?|Vessel)\s*:?\s*(.+?)(?=\s+(?:Voyage|VOYAGE|Port\s+of\s+Loading|$))/i);if(v)return{value:v,source:source(p,'Vessel'),confidence:'Média'}}
  return empty('Agência Marítima / Navio não localizado.');
}
function importerCnpj(pages:PdfPage[]):Pick{
  for(const p of duimps(pages)){const m=all(p).match(/CNPJ\s+do\s+importador\s*:\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i);if(m?.[1])return{value:m[1],source:source(p,'CNPJ do importador'),confidence:'Alta'}}
  return empty('CNPJ do Cliente / Importador não localizado.');
}
function containers(pages:PdfPage[]):Pick{
  const found:Array<{value:string;page:PdfPage}>=[];
  for(const p of duimps(pages)){
    const text=all(p),block=text.match(/CONTEINERES\.*\s*:\s*(.+?)(?=\s+(?:ESPECIE|LOCAL\s+DE\s+EMBARQUE|VE[IÍ]CULO|$))/i)?.[1]||'';
    for(const m of block.matchAll(/\b([A-Z]{4})[- .]?(\d{3})[- .]?(\d{3})[- .]?(\d)\b/g))found.push({value:`${m[1]}${m[2]}${m[3]}${m[4]}`,page:p});
  }
  if(!found.length)for(const p of bls(pages))for(const m of all(p).matchAll(/\b([A-Z]{4})\s*(\d{7})\b/g))found.push({value:`${m[1]}${m[2]}`,page:p});
  const unique=[...new Map(found.map(item=>[item.value,item])).values()];
  if(!unique.length)return empty('Contêineres não localizados.');
  const src=unique.length===1?source(unique[0].page,'CONTEINERES'):`PDFs · ${unique.map(i=>`${i.page.filename} · página ${i.page.page} · ${i.value}`).join(' + ')} · contêineres`;
  return{value:unique.map(i=>i.value).join(', '),source:src,confidence:'Alta'};
}
function weight(pages:PdfPage[]):Pick{
  const found:Array<{key:string;value:number;display:string;page:PdfPage}>=[];
  for(const p of duimps(pages)){
    const text=all(p),m=text.match(/Peso\s+L[ií]quido\s*\(kg\)\s*:\s*([\d.]+,\d{3,5})/i);if(!m?.[1])continue;
    const value=brNumber(m[1]);if(value===null)continue;
    const doc=text.match(/Extrato\s+da\s+Duimp\s+([0-9]{2}BR[0-9-]+)/i)?.[1]||p.filename;
    found.push({key:norm(doc),value,display:m[1],page:p});
  }
  const unique=[...new Map(found.map(x=>[x.key,x])).values()];
  if(!unique.length)return empty('Peso Líquido não localizado no Extrato da DUIMP.');
  const total=unique.reduce((a,b)=>a+b.value,0);
  const src=unique.length===1?source(unique[0].page,'Peso Líquido (kg)'):`Soma de ${unique.length} Extratos DUIMP únicos · ${unique.map(i=>`${i.page.filename} · página ${i.page.page} · ${i.display}`).join(' + ')}`;
  return{value:formatBr(total,5),source:src,confidence:'Alta'};
}
function nfeKey(p:PdfPage,value:string){
  const text=all(p),access=text.match(/CHAVE\s+DE\s+ACESSO(?:\s+DA\s+NF-?E)?\s*([\d\s]{44,80})/i)?.[1]?.replace(/\D/g,'').slice(0,44);
  if(access?.length===44)return access;
  const number=text.match(/N\.?\s*(\d{3,15})/i)?.[1]||p.filename;
  return`${number}:${value}`;
}
function noteTotal(pages:PdfPage[]):Pick{
  const found:Array<{key:string;value:number;display:string;page:PdfPage}>=[];
  for(const p of nfs(pages)){
    const text=all(p),m=text.match(/VALOR\s+TOTAL\s+DA\s+NOTA\s+([\d.]+,\d{2})/i);
    if(!m?.[1])continue;
    const value=brNumber(m[1]);if(value===null)continue;
    found.push({key:nfeKey(p,m[1]),value,display:m[1],page:p});
  }
  const unique=[...new Map(found.map(x=>[x.key,x])).values()];
  if(!unique.length)return empty('Valor Total da Nota não localizado.');
  const total=unique.reduce((a,b)=>a+b.value,0);
  const src=unique.length===1?source(unique[0].page,'VALOR TOTAL DA NOTA'):`Soma de ${unique.length} NFs únicas · ${unique.map(i=>`${i.page.filename} · página ${i.page.page} · R$ ${i.display}`).join(' + ')}`;
  return{value:formatBr(total,2),source:src,confidence:'Alta'};
}
function field(label:CevaReportFieldLabel,pick:Pick):CevaAnalysisField{return{label,value:pick.value||'—',source:pick.source,confidence:pick.confidence}}

export async function runCevaAnalysis(files:File[]):Promise<CevaAnalysisSnapshot>{
  if(!files.length)throw new Error('Selecione pelo menos um PDF da CEVA.');
  const pages=await readPdfs(files);
  const picks:Record<CevaReportFieldLabel,Pick>={
    'Cliente':client(pages),
    'Tipo Documento':docType(pages),
    'Remetente / Exportador':exporter(pages),
    'Nº BL / AWB':blNumber(pages),
    'Local de Armazenagem':storage(pages),
    'Ref. do Cliente':refClient(pages),
    'Nº Documento':documentNumber(pages),
    'Destinatário / Importador':importer(pages),
    'Operação Marítima':operation(pages),
    'Agência Marítima':vessel(pages),
    'CNPJ do Cliente / Importador':importerCnpj(pages),
    'Contêineres':containers(pages),
    'Peso Líquido':weight(pages),
    'Valor Total da Nota':noteTotal(pages)
  };
  const fields=CEVA_REPORT_FIELDS.map(label=>field(label,picks[label])),found=fields.filter(f=>f.value!=='—').length;
  return{client:'CEVA',processType:picks['Operação Marítima'].value||'Não identificado',summary:`${found}/${fields.length} campos localizados nos PDFs enviados`,fields,found,total:fields.length};
}
