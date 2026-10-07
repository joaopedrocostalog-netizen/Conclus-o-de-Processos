import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();

export const KEMIN_REPORT_FIELDS=Object.freeze([
  'Cliente',
  'Tipo Documento',
  'Remetente / Exportador',
  'Local de Armazenagem',
  'Ref. do Cliente',
  'Nº Documento',
  'Destinatário / Importador',
  'Operação Marítima',
  'Agência Marítima',
  'CNPJ do Cliente / Importador',
  'Peso Líquido',
  'Valor Total da Nota'
] as const);

export type KeminReportFieldLabel=typeof KEMIN_REPORT_FIELDS[number];
export type KeminAnalysisField={label:KeminReportFieldLabel;value:string;source:string;confidence:'Alta'|'Média'|'Baixa'};
export type KeminAnalysisSnapshot={client:'KEMIN';processType:string;summary:string;fields:KeminAnalysisField[];found:number;total:number};

type PdfPage={filename:string;page:number;rows:string[];text:string;flatText:string};
type Pick={value:string|null;source:string;confidence:'Alta'|'Média'|'Baixa'};

const clean=(value:string)=>value.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const one=(value:string)=>clean(value).replace(/\n/g,' ').trim();
const empty=(why:string):Pick=>({value:null,source:why,confidence:'Baixa'});
const pdfSource=(p:PdfPage,note:string)=>`PDF · ${p.filename} · página ${p.page} · ${note}`;

function itemsToRows(items:any[]):string[]{
  const cells=items.filter(raw=>raw&&'str' in raw&&String(raw.str||'').trim()).map((raw:any)=>({str:String(raw.str||'').trim(),x:Number(raw.transform?.[4]||0),y:Number(raw.transform?.[5]||0)}));
  const groups:Array<{y:number;cells:typeof cells}>=[];
  for(const cell of cells){let group=groups.find(g=>Math.abs(g.y-cell.y)<=2.8);if(!group){group={y:cell.y,cells:[]};groups.push(group)}group.cells.push(cell)}
  return groups.sort((a,b)=>b.y-a.y).map(g=>g.cells.sort((a,b)=>a.x-b.x).map(c=>c.str).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean);
}

async function readPdf(file:File):Promise<PdfPage[]>{
  const pdf=await getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  const pages:PdfPage[]=[];
  for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
    const page=await pdf.getPage(pageNumber),content=await page.getTextContent(),items=content.items as any[],rows=itemsToRows(items);
    pages.push({filename:file.name,page:pageNumber,rows,text:clean(rows.join('\n')),flatText:clean(items.filter(raw=>raw&&'str' in raw).map((raw:any)=>String(raw.str||'').trim()).filter(Boolean).join(' '))});
  }
  return pages;
}

async function readPdfs(files:File[]){
  const out:PdfPage[]=[];
  for(const file of files)out.push(...await readPdf(file));
  return out;
}

const all=(p:PdfPage)=>one(`${p.text} ${p.flatText}`);
const isNfe=(p:PdfPage)=>/\bDANFE\b|NOTA FISCAL ELETR[OÔ]NICA|VALOR TOTAL DA NOTA|CHAVE DE ACESSO/i.test(all(p));
const nfePages=(pages:PdfPage[])=>pages.filter(isNfe);
const rows=(p:PdfPage)=>p.rows.map(one).filter(Boolean);

function clientName(pages:PdfPage[]):Pick{
  for(const p of pages){
    const rs=rows(p);
    const emitter=rs.findIndex(r=>/IDENTIFICA[CÇ][AÃ]O DO EMITENTE/i.test(r));
    if(emitter>=0){
      for(const r of rs.slice(emitter+1,emitter+8)){
        if(/\bLTDA\b|\bS\/A\b|\bSA\b/i.test(r)&&!/IDENTIFICA|DANFE|CNPJ|ENDERE[CÇ]O/i.test(r))return{value:r,source:pdfSource(p,'Identificação do emitente'),confidence:'Alta'};
      }
    }
    for(let i=0;i<rs.length;i++){
      if(/NOME\s*\/\s*RAZ[AÃ]O SOCIAL/i.test(rs[i])){
        for(const r of rs.slice(i+1,i+5))if(/\bLTDA\b|\bS\/A\b|\bSA\b/i.test(r))return{value:r,source:pdfSource(p,'Nome / Razão Social'),confidence:'Média'};
      }
    }
  }
  return empty('Cliente não localizado dinamicamente nos PDFs enviados.');
}

function documentType(pages:PdfPage[]):Pick{
  for(const p of pages){
    const text=all(p);
    if(/\bDUIMP\b/i.test(text))return{value:'DUIMP',source:pdfSource(p,'menção ao tipo de documento DUIMP'),confidence:'Alta'};
  }
  return empty('Tipo de documento não identificado nos PDFs.');
}

function exporter(pages:PdfPage[]):Pick{
  for(const p of pages){
    const rs=rows(p),marker=rs.findIndex(r=>/DESTINAT[ÁA]RIO\s*\/\s*REMETENTE/i.test(r));
    if(marker>=0){
      for(const r of rs.slice(marker+1,marker+10)){
        if(/^(NOME\/RAZ[AÃ]O SOCIAL|CNPJ|CPF|DATA|ENDERE[CÇ]O|BAIRRO|MUNIC[IÍ]PIO|FONE|CEP|UF|INSCRI[CÇ][AÃ]O)/i.test(r))continue;
        if(/[A-ZÀ-Ü]{3}/i.test(r)&&r.length>5)return{value:r,source:pdfSource(p,'Destinatário / Remetente'),confidence:'Alta'};
      }
    }
    const text=all(p);
    const m=text.match(/SHIPPER(?:\s*\([^)]*\))?\s*[:\-]?\s*(.{5,100}?)(?=\s+(?:CONSIGNEE|JOB\s*NO|BILL\s*OF\s*LADING))/i);
    if(m?.[1])return{value:one(m[1]),source:pdfSource(p,'Shipper / Exportador'),confidence:'Média'};
  }
  return empty('Remetente / Exportador não localizado nos PDFs.');
}

function storage(pages:PdfPage[]):Pick{
  const patterns=[
    /Recinto\s+Alfandegado\s*[:\-]\s*(.+?)(?=\s+(?:Ref\.|Fatura|DUIMP|$))/i,
    /Local\s+de\s+Armazenagem\s*[:\-]\s*(.+?)(?=\s{2,}|$)/i,
    /Recinto\s+Aduaneiro\s*[:\-]\s*(.+?)(?=\s{2,}|$)/i
  ];
  for(const p of pages){const text=all(p);for(const pattern of patterns){const m=text.match(pattern);if(m?.[1])return{value:one(m[1]),source:pdfSource(p,'local/recinto de armazenagem'),confidence:'Alta'}}}
  return empty('Local de Armazenagem não localizado nos PDFs.');
}

function clientRef(pages:PdfPage[]):Pick{
  const patterns=[
    /N\s*\/\s*REF\.?\s*[:\-]\s*([A-Z0-9./_-]+)/i,
    /Ref\.?\s*(?:do\s*)?Cliente\s*[:\-]\s*([A-Z0-9./_-]+)/i,
    /Ped\.?\s*Cliente\s*[:\-]\s*.*?\b([A-Z]{2,}\d[A-Z0-9_-]*)\b/i
  ];
  for(const p of pages){const text=all(p);for(const pattern of patterns){const m=text.match(pattern);if(m?.[1])return{value:m[1],source:pdfSource(p,'referência do cliente'),confidence:'Alta'}}}
  return empty('Ref. do Cliente não localizada nos PDFs.');
}

function documentNumber(pages:PdfPage[]):Pick{
  const duimp=/\b\d{2}BR\d{11}\b/i;
  for(const p of pages){const m=all(p).match(duimp);if(m)return{value:m[0].toUpperCase(),source:pdfSource(p,'número da DUIMP'),confidence:'Alta'}}
  return empty('Nº Documento não localizado nos PDFs.');
}

function importer(pages:PdfPage[]):Pick{
  for(const p of pages){
    const text=all(p);
    if(/IMPORTA[CÇ][AÃ]O|\bDUIMP\b/i.test(text)){
      const rs=rows(p);
      for(let i=0;i<rs.length;i++){
        if(/(?:01\s*-\s*)?Nome\s*\/\s*Raz[aã]o\s+Social/i.test(rs[i])){
          for(const r of rs.slice(i+1,i+5))if(r.length>4&&!/CNPJ|CPF|DATA|ENDERE[CÇ]O/i.test(r))return{value:r,source:pdfSource(p,'Nome / Razão Social do importador'),confidence:'Alta'};
        }
      }
    }
  }
  const client=clientName(pages);
  if(client.value)return{...client,source:client.source.replace(/Identificação do emitente|Nome \/ Razão Social/,'identificação do importador/cliente'),confidence:'Média'};
  return empty('Destinatário / Importador não localizado nos PDFs.');
}

function operation(pages:PdfPage[]):Pick{
  for(const p of pages){const text=all(p);if(/ICMS\s*-?\s*importa[cç][aã]o|\bDUIMP\b|IMPORTA[CÇ][AÃ]O/i.test(text))return{value:'Importação',source:pdfSource(p,'indicação de operação de importação'),confidence:'Alta'}}
  return empty('Operação Marítima não identificada nos PDFs.');
}

function shippingAgency(pages:PdfPage[]):Pick{
  const patterns=[
    /(?:AS\s+THE\s+CARRIER|CARRIER)\s*[:\-]?\s*(.{4,100}?)(?=\s+(?:BILL\s+OF\s+LADING|FOR\s+RELEASE|PLACE|VESSEL|$))/i,
    /AG[ÊE]NCIA\s+MAR[IÍ]TIMA\s*[:\-]\s*(.+?)(?=\s{2,}|$)/i,
    /SHIPPING\s+AGENT\s*[:\-]\s*(.+?)(?=\s{2,}|$)/i
  ];
  for(const p of pages){const text=all(p);for(const pattern of patterns){const m=text.match(pattern);if(m?.[1])return{value:one(m[1]),source:pdfSource(p,'agência/carrier marítimo'),confidence:'Média'}}}
  return empty('Agência Marítima não localizada em texto pesquisável nos PDFs.');
}

function importerCnpj(pages:PdfPage[]):Pick{
  const cnpj=/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/;
  for(const p of pages){
    const text=all(p);
    if(!/IMPORTA[CÇ][AÃ]O|\bDUIMP\b/i.test(text))continue;
    const rs=rows(p);
    for(let i=0;i<rs.length;i++){
      if(/CNPJ(?:\s+Base)?\s*\/\s*CPF|CNPJ\s*\/\s*CPF|\bCNPJ\b/i.test(rs[i])){
        for(const r of rs.slice(i,i+5)){const m=r.match(cnpj);if(m)return{value:m[0],source:pdfSource(p,'CNPJ do importador/cliente'),confidence:'Alta'}}
      }
    }
    const m=text.match(cnpj);if(m)return{value:m[0],source:pdfSource(p,'CNPJ do importador/cliente'),confidence:'Média'};
  }
  for(const p of nfePages(pages)){const m=all(p).match(cnpj);if(m)return{value:m[0],source:pdfSource(p,'CNPJ no cabeçalho da NF'),confidence:'Média'}}
  return empty('CNPJ do Cliente / Importador não localizado nos PDFs.');
}

function parsePtBrNumber(value:string){const n=Number(value.replace(/\./g,'').replace(',','.'));return Number.isFinite(n)?n:null}
function formatPtBr(value:number,decimals:number){return new Intl.NumberFormat('pt-BR',{minimumFractionDigits:decimals,maximumFractionDigits:decimals,useGrouping:true}).format(value)}
function pagesByFile(pages:PdfPage[]){const map=new Map<string,PdfPage[]>();for(const p of nfePages(pages)){const current=map.get(p.filename)||[];current.push(p);map.set(p.filename,current)}return map}

function netWeight(pages:PdfPage[]):Pick{
  const found:Array<{value:number;display:string;page:PdfPage}>=[];
  for(const [,filePages] of pagesByFile(pages)){
    let hit:{value:number;display:string;page:PdfPage}|null=null;
    for(const p of filePages){
      const rs=rows(p),marker=rs.findIndex(r=>/PESO\s+BRUTO.*PESO\s+L[IÍ]QUIDO/i.test(r)||/PESO\s+L[IÍ]QUIDO/i.test(r));
      if(marker<0)continue;
      for(const r of rs.slice(marker+1,marker+7)){
        const values=[...r.matchAll(/\b\d{1,9}(?:\.\d{3})*,\d{3}\b/g)].map(m=>m[0]);
        if(!values.length)continue;
        const display=values[values.length-1],value=parsePtBrNumber(display);
        if(value!==null){hit={value,display,page:p};break}
      }
      if(hit)break;
    }
    if(hit)found.push(hit);
  }
  if(!found.length)return empty('Peso Líquido não localizado nas NFs.');
  const total=found.reduce((sum,item)=>sum+item.value,0);
  const source=found.length===1?pdfSource(found[0].page,'PESO LÍQUIDO'):`Soma de ${found.length} NFs · ${found.map(item=>`${item.page.filename} · página ${item.page.page} · ${item.display}`).join(' + ')}`;
  return{value:formatPtBr(total,3),source,confidence:'Alta'};
}

function noteValue(pages:PdfPage[]):Pick{
  const found:Array<{value:number;display:string;page:PdfPage}>=[];
  for(const [,filePages] of pagesByFile(pages)){
    let hit:{value:number;display:string;page:PdfPage}|null=null;
    for(const p of filePages){
      const rs=rows(p),marker=rs.findIndex(r=>/VALOR\s+TOTAL\s+DA\s+NOTA/i.test(r));if(marker<0)continue;
      const candidates:string[]=[];
      for(const r of rs.slice(marker,marker+6))for(const m of r.matchAll(/\b\d{1,3}(?:\.\d{3})*,\d{2}\b/g))candidates.push(m[0]);
      if(candidates.length){
        const ranked=candidates.map(display=>({display,value:parsePtBrNumber(display)})).filter((item):item is {display:string;value:number}=>item.value!==null).sort((a,b)=>b.value-a.value);
        if(ranked.length){hit={...ranked[0],page:p};break}
      }
    }
    if(hit)found.push(hit);
  }
  if(!found.length)return empty('Valor Total da Nota não localizado nas NFs.');
  const total=found.reduce((sum,item)=>sum+item.value,0);
  const source=found.length===1?pdfSource(found[0].page,'VALOR TOTAL DA NOTA'):`Soma de ${found.length} NFs · ${found.map(item=>`${item.page.filename} · página ${item.page.page} · R$ ${item.display}`).join(' + ')}`;
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
    'Local de Armazenagem':storage(pages),
    'Ref. do Cliente':clientRef(pages),
    'Nº Documento':documentNumber(pages),
    'Destinatário / Importador':importer(pages),
    'Operação Marítima':operation(pages),
    'Agência Marítima':shippingAgency(pages),
    'CNPJ do Cliente / Importador':importerCnpj(pages),
    'Peso Líquido':netWeight(pages),
    'Valor Total da Nota':noteValue(pages)
  };
  const fields=KEMIN_REPORT_FIELDS.map(label=>field(label,picks[label])),found=fields.filter(item=>item.value!=='—').length;
  const processType=picks['Operação Marítima'].value||'Não identificado';
  return{client:'KEMIN',processType,summary:`${found}/${fields.length} campos localizados nos PDFs enviados`,fields,found,total:fields.length};
}
