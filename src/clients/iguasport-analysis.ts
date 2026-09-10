import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import JSZip from 'jszip';

GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();

export type IguasportInputFiles={pdfs:File[];zip:File|null};

export const IGUASPORT_REPORT_FIELDS=Object.freeze([
  'Cliente','Tipo Documento','Remetente / Exportador','Nº BL / AWB','Local de Armazenagem','Ref. do Cliente','Nº Documento','Destinatário / Importador','Operação Marítima','Agência Marítima','CNPJ do Cliente / Importador','Contêineres','Peso Líquido','Valor Total da Nota'
] as const);
export type IguasportReportFieldLabel=typeof IGUASPORT_REPORT_FIELDS[number];
export type IguasportAnalysisField={label:IguasportReportFieldLabel;value:string;source:string;confidence:'Alta'|'Média'|'Baixa'};
export type IguasportAnalysisSnapshot={client:'IGUASPORT';processType:string;summary:string;fields:IguasportAnalysisField[];found:number;total:number};

export const IGUASPORT_ANALYSIS_BASE=Object.freeze({id:'iguasport-v1',client:'IGUASPORT',isolated:true,reportFields:IGUASPORT_REPORT_FIELDS});

type Kind='DUIMP'|'NF-e'|'BL'|'DARE'|'PDF';
type DocumentKind=Exclude<Kind,'PDF'>;
type Page={page:number;text:string;flatText:string;rows:string[];filename:string;kind:Kind};
type Pick={value:string|null;source:string;confidence:'Alta'|'Média'|'Baixa'};

const clean=(s:string)=>s.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const one=(s:string)=>clean(s).replace(/\n/g,' ').trim();
const empty=(why='Não localizado nos documentos da IGUASPORT'):Pick=>({value:null,source:why,confidence:'Baixa'});
const picked=(value:string,page:Page,note=''):Pick=>({value:one(value),source:`${page.kind} · ${page.filename} · página ${page.page}${note?` · ${note}`:''}`,confidence:'Alta'});
const formatCnpj=(v:string)=>{const d=v.replace(/\D/g,'');return d.length===14?`${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`:v};

function itemsToRows(items:any[]):string[]{
  const cells=items.filter(raw=>raw&&'str' in raw&&String(raw.str||'').trim()).map((raw:any)=>({str:String(raw.str||'').trim(),x:Number(raw.transform?.[4]||0),y:Number(raw.transform?.[5]||0)}));
  const groups:Array<{y:number;cells:typeof cells}>=[];
  for(const cell of cells){let group=groups.find(g=>Math.abs(g.y-cell.y)<=2.8);if(!group){group={y:cell.y,cells:[]};groups.push(group)}group.cells.push(cell)}
  return groups.sort((a,b)=>b.y-a.y).map(g=>g.cells.sort((a,b)=>a.x-b.x).map(c=>c.str).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean);
}
function classify(text:string,name:string):Kind{
  const strongBl=/BILL OF LADING|B\s*\/\s*L\s*No\.?|SIGNED\s+FOR\s+THE\s+CARRIER|AGENTS?\s+FOR\s+THE\s+CARRIER|\bSHIPPER\b|\bCONSIGNEE\b|\bEXPORTER\s*:/i.test(text)||/\bBL\b/i.test(name);
  if(strongBl)return'BL';
  if(/\bDANFE\b|Nota Fiscal Eletr[oô]nica|VALOR TOTAL DA NOTA/i.test(text))return'NF-e';
  if(/Extrato\s+da\s+Duimp|\bDUIMP\b/i.test(text))return'DUIMP';
  if(/\bDARE-SP\b|Documento de Arrecada[cç][aã]o de Receitas Estaduais/i.test(text))return'DARE';
  return'PDF';
}
async function readPdfData(data:ArrayBuffer|Uint8Array,filename:string):Promise<Page[]>{
  const pdf=await getDocument({data}).promise;const pages:Page[]=[];
  for(let i=1;i<=pdf.numPages;i++){
    const p=await pdf.getPage(i);const c=await p.getTextContent();const items=c.items as any[];const rows=itemsToRows(items);const text=clean(rows.join('\n'));const flatText=clean(items.filter(raw=>raw&&'str' in raw).map((raw:any)=>String(raw.str||'').trim()).filter(Boolean).join(' '));
    pages.push({page:i,text,flatText,rows,filename,kind:'PDF'});
  }
  const sample=pages.slice(0,Math.min(3,pages.length)).map(p=>`${p.text}\n${p.flatText}`).join('\n');const kind=classify(sample,filename);
  return pages.map(p=>({...p,kind}));
}
async function readInputs(files:IguasportInputFiles){
  if(files.zip){
    const zip=await JSZip.loadAsync(await files.zip.arrayBuffer());const entries=Object.values(zip.files).filter(e=>!e.dir&&e.name.toLowerCase().endsWith('.pdf'));
    if(!entries.length)throw new Error('Nenhum PDF foi encontrado dentro do ZIP da IGUASPORT.');
    const out:Page[]=[];for(const entry of entries)out.push(...await readPdfData(await entry.async('uint8array'),entry.name));return out;
  }
  if(!files.pdfs.length)throw new Error('Selecione pelo menos um PDF ou um arquivo ZIP.');
  const out:Page[]=[];for(const file of files.pdfs)out.push(...await readPdfData(await file.arrayBuffer(),file.name));return out;
}
function pagesOf(pages:Page[],kind:Kind){return pages.filter(p=>p.kind===kind)}
function blLikePages(pages:Page[]){return pages.filter(p=>p.kind==='BL'||/BILL OF LADING|B\s*\/\s*L\s*No\.?|SIGNED\s+FOR\s+THE\s+CARRIER|AGENTS?\s+FOR\s+THE\s+CARRIER|\bSHIPPER\b|\bCONSIGNEE\b|\bEXPORTER\s*:|MAERSK|CMA\s*CGM|HAPAG[- ]LLOYD|MSC\b|COSCO|EVERGREEN|YANG\s*MING|\bZIM\b/i.test(`${p.text} ${p.flatText} ${p.filename}`))}
function match(pages:Page[],patterns:RegExp[]):Pick{for(const p of pages)for(const re of patterns){const m=p.text.match(re);if(m?.[1])return picked(m[1],p)}return empty()}
function firstPage(pages:Page[],kind:Kind){return pages.find(p=>p.kind===kind&&p.page===1)||pages.find(p=>p.kind===kind)}

function cliente(pages:Page[]):Pick{
  const duimp=match(pagesOf(pages,'DUIMP'),[/Nome do importador:\s*\n?\s*([^\n]+)/i]);if(duimp.value)return duimp;
  const nf=firstPage(pages,'NF-e');if(nf){const m=nf.text.match(/\n\s*(Iguasport\s+LTDA\.?)\s*\n/i);if(m?.[1])return picked(m[1],nf)}
  return empty();
}
function tipoDocumento(pages:Page[]):Pick{
  const kinds:DocumentKind[]=[...new Set(pages.map(p=>p.kind).filter((k):k is DocumentKind=>k!=='PDF'))];if(!kinds.length)return empty();
  const order:DocumentKind[]=['DUIMP','DARE','BL','NF-e'];const value=order.filter(k=>kinds.includes(k)).join(' + ');
  return{value,source:`Tipos identificados nos ${new Set(pages.map(x=>x.filename)).size} PDF(s) analisados`,confidence:'Alta'};
}
function cleanParty(value:string){
  return one(value)
    .replace(/^[:\-\s]+/,'')
    .replace(/\s+(?:WOODEN PACKING|CNPJ|CPF|NCM|ADDRESS|ENDEREÇO|TEL|PHONE|CONSIGNEE|NOTIFY PARTY|SHIPPER|PRE CARRIAGE|PLACE OF RECEIPT|VESSEL|PORT OF|FREIGHT|VERSÃO|VERSAO)\b.*$/i,'')
    .replace(/[|·]+$/g,'')
    .trim();
}
function invalidParty(value:string){
  if(!value||value.length<3)return true;
  if(/^(VERS[AÃ]O:?|ENDEREÇO:?|PA[IÍ]S:?|N[ÚU]MERO DE IDENTIFICAÇÃO:?|CÓDIGO DO EXPORTADOR ESTRANGEIRO:?|SHIPPER:?|CONSIGNEE:?|NOTIFY PARTY:?|EXPORTER:?)$/i.test(value))return true;
  if(/\b(assumes?|shipowner|contractual|legal duty|their cargo|terms and conditions|hereunder|thereof|pursuant|shall be|merchant acknowledges|carrier shall)\b/i.test(value))return true;
  if(value.split(/\s+/).length>14)return true;
  return false;
}
function exporterFromDuimp(p:Page){
  const direct=p.text.match(/C[oó]digo do Exportador Estrangeiro:\s*\n\s*OPE_\d+\s*-\s*([^\n]+)/i);
  if(direct?.[1]){const value=cleanParty(direct[1]);if(!invalidParty(value))return value}
  for(let i=0;i<p.rows.length;i++){
    if(!/^\s*C[oó]digo do Exportador Estrangeiro\s*:?\s*$/i.test(p.rows[i]))continue;
    for(const row of p.rows.slice(i+1,i+4)){
      const m=row.match(/^\s*OPE_\d+\s*-\s*(.+)$/i);
      if(m?.[1]){const value=cleanParty(m[1]);if(!invalidParty(value))return value}
    }
  }
  return'';
}
function remetente(pages:Page[]):Pick{
  const blPages=blLikePages(pages).filter(p=>p.page===1);
  for(const p of blPages){
    for(const row of p.rows){
      const m=row.match(/^\s*EXPORTER\s*:\s*(.+?)\s*$/i);
      if(m?.[1]){const value=cleanParty(m[1]);if(!invalidParty(value))return picked(value,p,'EXPORTER no BL')}
    }
    const exactLine=p.text.match(/^\s*EXPORTER\s*:\s*([^\n]{3,100})\s*$/im);
    if(exactLine?.[1]){const value=cleanParty(exactLine[1]);if(!invalidParty(value))return picked(value,p,'EXPORTER no BL')}
  }
  for(const p of pagesOf(pages,'DUIMP')){const value=exporterFromDuimp(p);if(value)return picked(value,p,'Código do Exportador Estrangeiro na DUIMP')}
  for(const p of blPages){
    const shipperLine=p.text.match(/^\s*SHIPPER\s*:?\s*([^\n]{3,100})\s*$/im);
    if(shipperLine?.[1]){const value=cleanParty(shipperLine[1]);if(!invalidParty(value))return picked(value,p,'SHIPPER no BL')}
  }
  return empty('Remetente / Exportador não localizado em um campo identificado do BL ou da DUIMP da IGUASPORT');
}
function blNumber(pages:Page[]):Pick{
  for(const p of blLikePages(pages)){
    for(let i=0;i<p.rows.length;i++){
      const row=p.rows[i];
      let m=row.match(/B\s*\/\s*L\s*(?:No\.?|N[oº°]\.?|NUMBER)\s*[:#.-]?\s*([A-Z0-9-]{6,20})\b/i);
      if(m?.[1]&&!/^(NO|NUMBER)$/i.test(m[1]))return picked(m[1],p,'B/L No.');
      m=row.match(/BILL\s+OF\s+LADING\s+(?:NO\.?|NUMBER)\s*[:#.-]?\s*([A-Z0-9-]{6,20})\b/i);
      if(m?.[1])return picked(m[1],p,'Bill of Lading Number');
      if(/(?:B\s*\/\s*L\s*(?:No\.?|N[oº°]\.?)|BILL\s+OF\s+LADING\s+(?:NO\.?|NUMBER))\s*[:#.-]?\s*$/i.test(row)){
        for(const next of p.rows.slice(i+1,i+3)){const v=next.match(/^\s*([A-Z0-9-]{6,20})\s*$/i);if(v?.[1])return picked(v[1],p,'valor imediatamente abaixo de B/L No.')}
      }
    }
    const byName=p.filename.match(/(?:^|[-_\s])([A-Z]{2,5}\d{6,10}|\d{7,12})(?=[-_.\s]|$)/i);if(byName?.[1])return picked(byName[1],p,'identificado pelo nome do arquivo');
  }
  return empty('B/L No. não localizado no conhecimento marítimo da IGUASPORT');
}
function localArmazenagem(pages:Page[]):Pick{return match(pagesOf(pages,'DUIMP'),[/Local de armazenamento\s*(?:-&gt;|->|:)\s*([^\n]+)/i,/Recinto:\s*\n?\s*([^\n]+)/i])}
function refCliente(pages:Page[]):Pick{return match(pages,[/Refer[eê]ncia do cliente\s*(?:-&gt;|->|:)\s*([A-Z0-9./-]+)/i,/Ref\.\s*Cliente\s*:\s*([A-Z0-9./-]+)/i])}
function numeroDocumento(pages:Page[]):Pick{return match(pagesOf(pages,'DUIMP'),[/Extrato da Duimp\s+([0-9A-Z-]{10,25})/i,/\bDUIMP\s*[:.]?\s*([0-9A-Z-]{10,25})/i])}
function destinatario(pages:Page[]):Pick{
  const d=match(pagesOf(pages,'DUIMP'),[/Nome do importador:\s*\n?\s*([^\n]+)/i]);if(d.value)return d;
  return empty();
}
function operacao(pages:Page[]):Pick{
  const duimp=firstPage(pages,'DUIMP');if(duimp)return{value:'Importação',source:`DUIMP · ${duimp.filename} · página ${duimp.page} · Processo de Importação`,confidence:'Alta'};
  const bl=blLikePages(pages)[0];if(bl)return{value:'Importação',source:`BL · ${bl.filename} · página ${bl.page}`,confidence:'Média'};return empty();
}
function cleanAgency(value:string){
  return one(value)
    .replace(/^[:\-\s]+/,'')
    .replace(/^BY\s+/i,'')
    .replace(/\s+BY\b.*$/i,'')
    .replace(/\s+(?:PLACE AND DATE|SIGNED FOR THE SHIPPER|VOYAGE NUMBER|BILL OF LADING|VESSEL|PORT OF|KGS|CBM|DRAFT)\b.*$/i,'')
    .replace(/^[|·_]+|[|·_]+$/g,'')
    .replace(/\s{2,}/g,' ')
    .trim();
}
function plausibleAgency(value:string){return value.length>=2&&!/^(BY|SIGNATURE|PLACE|DATE|DRAFT|KGS|CBM|VOYAGE|VESSEL|CARRIER)$/i.test(value)&&!/^_{3,}$/.test(value)}
function knownCarrier(source:string){
  const patterns:[RegExp,string][]=[
    [/\bMAERSK\s+A\/S\b/i,'Maersk A/S'],
    [/\bCMA\s+CGM\s+S\.?\s*A\.?\b/i,'CMA CGM S.A.'],
    [/\bHAPAG[- ]LLOYD\b/i,'Hapag-Lloyd'],
    [/\bMSC(?:\s+MEDITERRANEAN\s+SHIPPING\s+COMPANY)?\b/i,'MSC'],
    [/\bCOSCO(?:\s+SHIPPING)?\b/i,'COSCO Shipping'],
    [/\bEVERGREEN(?:\s+MARINE)?\b/i,'Evergreen'],
    [/\bYANG\s+MING\b/i,'Yang Ming'],
    [/\bZIM(?:\s+INTEGRATED\s+SHIPPING\s+SERVICES)?\b/i,'ZIM'],
    [/\bOCEAN\s+NETWORK\s+EXPRESS\b|\bONE\b(?=\s+(?:LINE|SHIPPING|CONTAINER))/i,'Ocean Network Express']
  ];
  for(const [re,name] of patterns)if(re.test(source))return name;
  return'';
}
function agencia(pages:Page[]):Pick{
  for(const p of blLikePages(pages)){
    const sources=[...p.rows,p.text,p.flatText];
    for(const source of sources){
      let m=source.match(/SIGNED\s+FOR\s+THE\s+CARRIER\s*[:\-]?\s*([^\n]{2,100})/i);
      if(m?.[1]){const value=cleanAgency(m[1]);if(plausibleAgency(value)&&!/^BY\b/i.test(value))return picked(value,p,'Signed for the Carrier')}
      m=source.match(/AS\s+AGENTS?\s+FOR\s+THE\s+CARRIER\s*[:\-]?\s*([^\n]{2,100})/i);
      if(m?.[1]){const value=cleanAgency(m[1]);if(plausibleAgency(value))return picked(value,p,'as agents for the carrier')}
    }
    const combined=`${p.text}\n${p.flatText}`;
    const carrier=knownCarrier(combined);
    if(carrier)return picked(carrier,p,'carrier identificado no conhecimento marítimo');
  }
  return empty('Agência marítima não localizada no conhecimento marítimo da IGUASPORT');
}
function cnpj(pages:Page[]):Pick{
  const d=match(pagesOf(pages,'DUIMP'),[/CNPJ do importador:\s*\n?\s*([0-9./-]{14,20})/i]);if(d.value){d.value=formatCnpj(d.value);return d}
  const n=match(pagesOf(pages,'NF-e'),[/\bCNPJ\b[\s\S]{0,120}?\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/i]);if(n.value){n.value=formatCnpj(n.value);return n}return empty();
}
function containers(pages:Page[]):Pick{
  const duimp=match(pagesOf(pages,'DUIMP'),[/Containers\s*(?:-&gt;|->|:)\s*([^\n]+)/i]);if(duimp.value){const all=[...duimp.value.matchAll(/\b[A-Z]{4}\d{7}\b/g)].map(m=>m[0]);if(all.length)duimp.value=[...new Set(all)].join(' / ');return duimp}
  for(const p of pages){const all=[...p.text.matchAll(/\b[A-Z]{4}\s*\d{7}\b/g)].map(m=>m[0].replace(/\s/g,''));if(all.length)return picked([...new Set(all)].join(' / '),p)}return empty();
}
function pesoLiquido(pages:Page[]):Pick{
  const d=match(pagesOf(pages,'DUIMP'),[/Peso L[ií]quido Total\s*(?:-&gt;|->|:)\s*([0-9.,]+)/i,/Peso L[ií]quido \(kg\):\s*\n?\s*([0-9.,]+)/i]);if(d.value){d.value=`${d.value} kg`;return d}
  const n=match(pagesOf(pages,'NF-e'),[/PESO L[IÍ]QUIDO[\s\n:]*([0-9.,]+)/i]);if(n.value){n.value=`${n.value} kg`;return n}return empty();
}
function valorNota(pages:Page[]):Pick{return match(pagesOf(pages,'NF-e'),[/VALOR TOTAL DA NOTA\s*\n?\s*([0-9.]+,[0-9]{2})/i])}

export async function runIguasportAnalysis(files:IguasportInputFiles):Promise<IguasportAnalysisSnapshot>{
  const pages=await readInputs(files);
  const values:Record<IguasportReportFieldLabel,Pick>={
    'Cliente':cliente(pages),'Tipo Documento':tipoDocumento(pages),'Remetente / Exportador':remetente(pages),'Nº BL / AWB':blNumber(pages),'Local de Armazenagem':localArmazenagem(pages),'Ref. do Cliente':refCliente(pages),'Nº Documento':numeroDocumento(pages),'Destinatário / Importador':destinatario(pages),'Operação Marítima':operacao(pages),'Agência Marítima':agencia(pages),'CNPJ do Cliente / Importador':cnpj(pages),'Contêineres':containers(pages),'Peso Líquido':pesoLiquido(pages),'Valor Total da Nota':valorNota(pages)
  };
  const fields=IGUASPORT_REPORT_FIELDS.map(label=>{const r=values[label];return{label,value:r.value||'Não localizado no documento.',source:r.source,confidence:r.confidence}});
  const found=fields.filter(f=>!/^Não localizado/i.test(f.value)).length;
  return{client:'IGUASPORT',processType:values['Operação Marítima'].value||'Não identificado',summary:`${found} de ${fields.length} campos localizados na análise IGUASPORT`,fields,found,total:fields.length};
}