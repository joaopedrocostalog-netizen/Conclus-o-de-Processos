import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { BRASALPLA_REPORT_FIELDS } from './brasalpla-report';
import { createWorker } from 'tesseract.js';

GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();


export type BrasalplaReportFieldLabel=typeof BRASALPLA_REPORT_FIELDS[number];
export type BrasalplaAnalysisField={label:BrasalplaReportFieldLabel;value:string;source:string;confidence:'Alta'|'Média'|'Baixa'};
export type BrasalplaAnalysisSnapshot={client:'BRASALPLA';processType:string;summary:string;fields:BrasalplaAnalysisField[];found:number;total:number};

type Cell={str:string;x:number;y:number;w:number;h:number};
type PdfPage={filename:string;page:number;rows:string[];text:string;flatText:string;ocr:boolean;cells:Cell[]};
type Pick={value:string|null;source:string;confidence:'Alta'|'Média'|'Baixa'};

const clean=(value:string)=>value.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const one=(value:string)=>clean(value).replace(/\n/g,' ').trim();
const norm=(value:string)=>value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
const empty=(why:string):Pick=>({value:null,source:why,confidence:'Baixa'});
const source=(p:PdfPage,note:string)=>`PDF · ${p.filename} · página ${p.page} · ${note}`;

let workerPromise:Promise<any>|null=null;
function getWorker(){return workerPromise||(workerPromise=createWorker('eng'))}

function itemsToCells(items:any[]):Cell[]{return items.filter(raw=>raw&&'str' in raw&&String(raw.str||'').trim()).map((raw:any)=>({str:String(raw.str||'').trim(),x:Number(raw.transform?.[4]||0),y:Number(raw.transform?.[5]||0),w:Number(raw.width||0),h:Number(raw.height||0)}))}
function itemsToRows(items:any[]):string[]{
  const cells=items.filter(raw=>raw&&'str' in raw&&String(raw.str||'').trim()).map((raw:any)=>({str:String(raw.str||'').trim(),x:Number(raw.transform?.[4]||0),y:Number(raw.transform?.[5]||0)}));
  const groups:Array<{y:number;cells:typeof cells}>=[];
  for(const cell of cells){let group=groups.find(g=>Math.abs(g.y-cell.y)<=2.8);if(!group){group={y:cell.y,cells:[]};groups.push(group)}group.cells.push(cell)}
  return groups.sort((a,b)=>b.y-a.y).map(g=>g.cells.sort((a,b)=>a.x-b.x).map(c=>c.str).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean);
}

async function ocrPage(page:any){
  const viewport=page.getViewport({scale:1.45});
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
    const cells=itemsToCells(items);
    let rows=itemsToRows(items),flat=clean(items.filter(raw=>raw&&'str' in raw).map((raw:any)=>String(raw.str||'').trim()).filter(Boolean).join(' ')),ocr=false;
    if((flat.replace(/\s/g,'').length<60 && (pageNumber<=2 || pdf.numPages<=3)) || (pageNumber===1 && /(?:BL|BOL|BILL|LADING)/i.test(file.name) && !/\bCARRIER\s*[:：-]/i.test(flat))){
      try{const scanned=await ocrPage(page);if(scanned){flat=scanned;rows=scanned.split(/\r?\n/).map(clean).filter(Boolean);ocr=true}}catch{}
    }
    pages.push({filename:file.name,page:pageNumber,rows,text:clean(rows.join('\n')),flatText:flat,ocr,cells});
  }
  return pages;
}
async function readPdfs(files:File[]){const perFile=await Promise.all(files.map(readPdf));return perFile.flat()}

const all=(p:PdfPage)=>one(`${p.text} ${p.flatText}`);
const isNfe=(p:PdfPage)=>/\bDANFE\b|NOTA FISCAL ELETR[OÔ]NICA|VALOR TOTAL DA NOTA|CHAVE DE ACESSO/i.test(all(p));
const isDuimp=(p:PdfPage)=>/EXTRATO\s+DA\s+DUIMP|NOME\s+DO\s+IMPORTADOR|SITUA[CÇ][AÃ]O\s+DA\s+DUIMP/i.test(all(p));
const isBl=(p:PdfPage)=>/BILL\s+OF\s+LADING|B\/?L-?NO|SHIPPER|CONSIGNEE|VESSEL|VOYAGE|CARRIER\s*:/i.test(all(p))||/\b(?:BL|BOL|LADING)\b/i.test(p.filename);
const nfs=(pages:PdfPage[])=>pages.filter(isNfe);
const duimps=(pages:PdfPage[])=>pages.filter(isDuimp);
const bls=(pages:PdfPage[])=>pages.filter(isBl);

function capture(text:string,pattern:RegExp){const m=text.match(pattern);return m?.[1]?one(m[1]):null}
function brNumber(value:string){const n=Number(value.replace(/\./g,'').replace(',','.'));return Number.isFinite(n)?n:null}
function formatBr(value:number,decimals:number){return new Intl.NumberFormat('pt-BR',{minimumFractionDigits:decimals,maximumFractionDigits:decimals}).format(value)}

function client(pages:PdfPage[]):Pick{
  for(const p of duimps(pages)){
    const value=capture(all(p),/Nome\s+do\s+importador\s*:\s*(.+?)(?=\s+(?:Endere[cç]o\s+do\s+importador|Informa[cç][oõ]es\s+Complementares|CNPJ\s+do\s+importador|$))/i);
    if(value)return{value,source:source(p,'Nome do importador'),confidence:'Alta'};
  }
  return empty('Cliente não localizado no campo Nome do importador do Extrato DUIMP.');
}
function docType(pages:PdfPage[]):Pick{for(const p of duimps(pages))return{value:'DUIMP',source:source(p,'Extrato da DUIMP'),confidence:'Alta'};return empty('Tipo Documento não localizado.')}
function exporter(pages:PdfPage[]):Pick{
  for(const p of nfs(pages)){
    const rs=p.rows,marker=rs.findIndex(r=>/DESTINAT[ÁA]RIO\s*\/\s*REMETENTE/i.test(r));
    if(marker<0)continue;
    const section=rs.slice(marker+1,marker+12);
    const labelIndex=section.findIndex(r=>/NOME\s*\/\s*RAZ[AÃ]O\s+SOCIAL/i.test(r));
    if(labelIndex<0)continue;
    const inline=section[labelIndex].replace(/^.*?NOME\s*\/\s*RAZ[AÃ]O\s+SOCIAL\s*/i,'').split(/\s+(?:CNPJ\/CPF|DATA\s+DE\s+EMISS[AÃ]O)/i)[0].trim();
    const following=(section[labelIndex+1]||'').split(/\s+(?:\d{2}\/\d{2}\/\d{4}|CNPJ\/CPF|DATA\s+DE\s+EMISS[AÃ]O)/i)[0].trim();
    const value=following.length>3?following:inline;
    if(value.length>3&&!/^(CNPJ|CPF|DATA|ENDERE[CÇ]O)/i.test(value))return{value,source:source(p,'DESTINATÁRIO/REMETENTE · NOME/RAZÃO SOCIAL'),confidence:'Alta'};
  }
  return empty('Remetente / Exportador não localizado na NF.');
}
function blNumber(pages:PdfPage[]):Pick{
  for(const p of duimps(pages)){
    const m=all(p).match(/\b(?:MBL|HBL)\s*:\s*([A-Z0-9-]{7,})/i)||all(p).match(/CONHECIMENTO\s+DE\s+CARGA\s*:\s*([A-Z0-9-]{7,})/i);
    if(m?.[1])return{value:m[1],source:source(p,'MBL / HBL / Conhecimento de Carga'),confidence:'Alta'};
  }

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
  for(const p of duimps(pages)){const m=all(p).match(/\bN\/REF\s*:\s*([A-Z0-9./-]+)/i);
    if(m?.[1])return{value:m[1],source:source(p,'N/REF'),confidence:'Alta'};}

  for(const p of duimps(pages)){
    const text=all(p),m=text.match(/REF\.?\s+IMPORTADOR\.*\s*:\s*([A-Z0-9./-]+)/i)||text.match(/REF\.?\s+REPRESENTANTE\.*\s*:\s*([A-Z0-9./-]+)/i);
    if(m?.[1])return{value:m[1],source:source(p,m[0].split(':')[0].trim()),confidence:'Alta'};
  }
  for(const p of nfs(pages)){const m=all(p).match(/S\/REF\.?\s*([A-Z0-9./-]+)/i);if(m?.[1])return{value:m[1],source:source(p,'S/REF.'),confidence:'Média'}}
  return empty('Ref. do Cliente não localizada.');
}
function documentNumber(pages:PdfPage[]):Pick{
  for(const p of duimps(pages)){const m=all(p).match(/Extrato\s+da\s+Duimp\s+([0-9]{2}BR[0-9-]+)/i);if(m?.[1])return{value:m[1],source:source(p,'título do Extrato da DUIMP'),confidence:'Alta'}}
  for(const p of nfs(pages)){
    const match=all(p).match(/\b(?:N[º°.]|NÚMERO)\s*0*(\d{5,12})\b/i);
    if(match?.[1])return{value:match[1],source:source(p,'Número da NF'),confidence:'Média'};
  }
  return empty('Nº Documento não localizado.');
}
function importer(pages:PdfPage[]):Pick{
  for(const p of duimps(pages)){const v=capture(all(p),/Nome\s+do\s+importador\s*:\s*(.+?)(?=\s+(?:Endere[cç]o\s+do\s+importador|Informa[cç][oõ]es\s+Complementares|CNPJ\s+do\s+importador|$))/i);if(v)return{value:v,source:source(p,'Nome do importador'),confidence:'Alta'}}
  return empty('Destinatário / Importador não localizado.');
}
function operation(pages:PdfPage[]):Pick{for(const p of duimps(pages))return{value:'Importação',source:source(p,'operação identificada pelo Extrato da DUIMP'),confidence:'Alta'};return empty('Operação não identificada.')}
function vessel(pages:PdfPage[]):Pick{
  for(const p of bls(pages)){
    const texts=[...p.rows,p.text,p.flatText];
    for(const text of texts){
      // The scanned CMA CGM B/L has the carrier in a compact inline label.
      const match=text.match(/\bCARRIER\s*[:：\-]?\s*(CMA\s*CGM|[A-Z][A-Z0-9.&\-]*(?:\s+[A-Z][A-Z0-9.&\-]*){0,5})(?=\s|$)/i);
      if(match?.[1]){
        let value=one(match[1]);
        if(/^CMA\s*CGM/i.test(value))value='CMA CGM';
        if(!/^(?:SHIPPER|CONSIGNEE|NOTIFY|THE|VESSEL)$/i.test(value))
          return{value,source:source(p,'CARRIER · Bill of Lading'),confidence:'Alta'};
      }
    }
    const blText=all(p);
    if(/\bCMA\s*CGM\b/i.test(blText)&&/BILL\s+OF\s+LADING|CARRIER|VOYAGE/i.test(blText))
      return{value:'CMA CGM',source:source(p,'CMA CGM · Carrier do Bill of Lading'),confidence:'Média'};
  }
  return empty('CARRIER não localizado no BL. Verifique se a página digitalizada está legível.');
}
function importerCnpj(pages:PdfPage[]):Pick{
  for(const p of duimps(pages)){const m=all(p).match(/CNPJ\s+do\s+importador\s*:\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i);if(m?.[1])return{value:m[1],source:source(p,'CNPJ do importador'),confidence:'Alta'}}
  for(const p of nfs(pages)){
    const match=all(p).match(/CNPJ\s*\/\s*CPF\s*[:\s]*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i);
    if(match?.[1])return{value:match[1],source:source(p,'CNPJ/CPF · emitente da NF'),confidence:'Média'};
  }
  return empty('CNPJ do Cliente / Importador não localizado.');
}
function containers(pages:PdfPage[]):Pick{
  const found=new Map<string,PdfPage>();
  for(const p of [...duimps(pages),...nfs(pages)]){
    for(const m of all(p).matchAll(/\bNRO\.?\s*:\s*([A-Z]{4})\s*[- ]?(\d{3})\s*[- ]?(\d{3})\s*[- ]?(\d)\b/gi)){
      found.set(`${m[1].toUpperCase()}${m[2]}${m[3]}${m[4]}`,p);
    }
  }
  if(found.size){const entries=[...found.entries()];const first=entries[0][1];const single=entries.every(([,p])=>p.filename===first.filename&&p.page===first.page);const src=single?source(first,'NRO. · contêineres'):`PDFs · ${entries.map(([value,p])=>`${p.filename} · página ${p.page} · ${value}`).join(' + ')} · contêineres identificados`;return{value:entries.map(([value])=>value).join(', '),source:src,confidence:'Alta'};}

  const fallbackFound:Array<{value:string;page:PdfPage}>=[];
  for(const p of duimps(pages)){
    const text=all(p),block=text.match(/CONTEINERES\.*\s*:\s*(.+?)(?=\s+(?:ESPECIE|LOCAL\s+DE\s+EMBARQUE|VE[IÍ]CULO|$))/i)?.[1]||'';
    for(const m of block.matchAll(/\b([A-Z]{4})[- .]?(\d{3})[- .]?(\d{3})[- .]?(\d)\b/g))fallbackFound.push({value:`${m[1]}${m[2]}${m[3]}${m[4]}`,page:p});
  }
  if(!fallbackFound.length)for(const p of bls(pages))for(const m of all(p).matchAll(/\b([A-Z]{4})\s*(\d{7})\b/g))fallbackFound.push({value:`${m[1]}${m[2]}`,page:p});
  const unique=[...new Map(fallbackFound.map(item=>[item.value,item])).values()];
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
  const key=p.cells.map(x=>x.str).join(' ').match(/(?:CHAVE\s+DE\s+ACESSO\s+DA\s+NF-?E\s*)?((?:\d[\s]*){44})/i)?.[1]?.replace(/\D/g,'');
  if(key?.length===44)return key;

  const text=all(p),access=text.match(/CHAVE\s+DE\s+ACESSO(?:\s+DA\s+NF-?E)?\s*([\d\s]{44,80})/i)?.[1]?.replace(/\D/g,'').slice(0,44);
  if(access?.length===44)return access;
  const number=text.match(/N\.?\s*(\d{3,15})/i)?.[1]||p.filename;
  return`${number}:${value}`;
}
function noteTotal(pages:PdfPage[]):Pick{
  type Invoice={key:string;number:string;value:number;display:string;page:PdfPage;kind:'mae'|'filhote'|'indefinida'};
  const found:Invoice[]=[];
  const allText=pages.map(p=>all(p)).join(' ');
  const normalized=norm(allText);
  const motherNumbers=new Set<string>();
  for(const match of normalized.matchAll(/(?:NOTA\s+FISCAL\s+M[AÃ]E|NF\s+M[AÃ]E)\s*(?:N[ºO.]?\s*)?0*(\d{5,12})/gi))motherNumbers.add(match[1]);
  const expectedCounts=[...normalized.matchAll(/(?:NF\s+)?FILHOT[EA]\s*(\d{1,3})\s*\/\s*(\d{1,3})/gi)].map(m=>Number(m[2]));
  for(const p of nfs(pages)){
    const text=all(p),token=(v:string)=>norm(v).replace(/[^A-Z0-9]/g,'');
    const labels=p.cells.filter(cell=>token(cell.str).includes('VALORTOTALDANOTA'));
    const splitLabels=p.cells.filter(cell=>token(cell.str)==='NOTA'&&p.cells.some(other=>/TOTAL/.test(token(other.str))&&Math.abs(other.y-cell.y)<3&&other.x<cell.x&&cell.x-other.x<125));
    const anchors=labels.length?labels:splitLabels;
    let display:string|null=null;
    for(const label of anchors){
      const values=p.cells.filter(cell=>/^\s*(?:R\$\s*)?\d[\d.]*,\d{2}\s*$/.test(cell.str)&&label.y-cell.y>2&&label.y-cell.y<24&&cell.x>=label.x-28&&cell.x<=label.x+175)
        .sort((a,b)=>Math.abs(label.y-a.y)-Math.abs(label.y-b.y)||b.x-a.x);
      if(values.length){display=values[0].str.replace(/R\$\s*/,'').trim();break}
    }
    if(!display)display=p.rows.map(row=>row.match(/VALOR\s+TOTAL\s+DA\s+NOTA\s*[:\-]?\s*(\d[\d.]*,\d{2})(?:\s|$)/i)?.[1]).find(Boolean)||null;
    if(!display)continue;
    const value=brNumber(display);if(value===null)continue;
    const number=(text.match(/(?:N[º°.]?\s*|NÚMERO\s*)(0*\d{6,12})\s*(?:S[ÉE]RIE|SERIE)/i)?.[1]||
      text.match(/\bN[º°.]?\s*(0*\d{6,12})\b/i)?.[1]||'').replace(/^0+/,'');
    const mentionedMother=number&&motherNumbers.has(number);
    const ownFlag=/\b(?:NOTA\s+FISCAL|NF)\s+M[AÃ]E\b/i.test(text)&&!/\bFILHOT[EA]\b/i.test(text);
    const childFlag=/\bFILHOT[EA]\s*\d+\s*\/\s*\d+/i.test(text);
    const kind:Invoice['kind']=mentionedMother||ownFlag?'mae':childFlag?'filhote':'indefinida';
    found.push({key:nfeKey(p,display),number,value,display,page:p,kind});
  }
  const unique=[...new Map(found.map(item=>[item.key,item])).values()];
  if(!unique.length)return empty('VALOR TOTAL DA NOTA não localizado com segurança nas NFs.');
  const mother=unique.filter(item=>item.kind==='mae');
  const children=unique.filter(item=>item.kind!=='mae');
  // In a mother/child process, do not add an unclassified NF without confirmation.
  const classified=mother.length||expectedCounts.length||unique.some(i=>i.kind==='filhote');
  const eligible=classified?children.filter(i=>i.kind==='filhote'||(i.number&&!motherNumbers.has(i.number))):children;
  if(classified&&!eligible.length)return empty('NF mãe identificada, mas nenhuma NF filhote foi localizada para somar.');
  const total=eligible.reduce((sum,item)=>sum+item.value,0);
  const parts=eligible.map(item=>item.page.filename+' · página '+item.page.page+' · R$ '+item.display);
  const motherNote=mother.length?' · NF mãe excluída: '+mother.map(i=>'Nº '+(i.number||'?')+' (R$ '+i.display+')').join(', '):'';
  const expected=Math.max(0,...expectedCounts);
  const missing=expected&&eligible.length<expected?' · ATENÇÃO: '+eligible.length+'/'+expected+' NFs filhotes identificadas; total parcial':'';
  const comparison=mother.length&&(!expected||eligible.length===expected)?' · Conferência com NF mãe: '+(Math.abs(total-mother[0].value)<0.01?'valores conferem':'DIVERGÊNCIA entre soma das filhotes e NF mãe'):'';
  const src=classified||eligible.length>1?'Soma de '+eligible.length+' NFs únicas · '+parts.join(' + ')+motherNote+missing+comparison:source(eligible[0].page,'VALOR TOTAL DA NOTA');
  return{value:formatBr(total,2),source:src,confidence:missing?'Baixa':mother.length&&comparison.includes('DIVERGÊNCIA')?'Baixa':'Alta'};
}
function field(label:BrasalplaReportFieldLabel,pick:Pick):BrasalplaAnalysisField{return{label,value:pick.value||'—',source:pick.source,confidence:pick.confidence}}

export async function runBrasalplaAnalysis(files:File[]):Promise<BrasalplaAnalysisSnapshot>{
  if(!files.length)throw new Error('Selecione pelo menos um PDF da BRASALPLA.');
  const pages=await readPdfs(files);
  const picks:Record<BrasalplaReportFieldLabel,Pick>={
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
  const fields=BRASALPLA_REPORT_FIELDS.map(label=>field(label,picks[label])),found=fields.filter(f=>f.value!=='—').length;
  return{client:'BRASALPLA',processType:picks['Operação Marítima'].value||'Não identificado',summary:`${found}/${fields.length} campos localizados nos PDFs enviados`,fields,found,total:fields.length};
}
