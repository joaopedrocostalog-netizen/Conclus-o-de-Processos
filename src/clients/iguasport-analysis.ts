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
type Page={page:number;text:string;filename:string;kind:Kind};
type Pick={value:string|null;source:string;confidence:'Alta'|'Média'|'Baixa'};

const clean=(s:string)=>s.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const one=(s:string)=>clean(s).replace(/\n/g,' ').trim();
const empty=(why='Não localizado nos documentos da IGUASPORT'):Pick=>({value:null,source:why,confidence:'Baixa'});
const picked=(value:string,page:Page,note=''):Pick=>({value:one(value),source:`${page.kind} · ${page.filename} · página ${page.page}${note?` · ${note}`:''}`,confidence:'Alta'});
const formatCnpj=(v:string)=>{const d=v.replace(/\D/g,'');return d.length===14?`${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`:v};

function itemsToText(items:any[]){
  let lastY:number|null=null,current='';const lines:string[]=[];
  for(const raw of items){
    if(!raw||!('str' in raw))continue;
    const item=raw as TextItem;const str=String(item.str||'').trim();if(!str)continue;
    const t=(item as any).transform||[];const y=Number(t[5]);
    if(lastY!==null&&Number.isFinite(y)&&Math.abs(y-lastY)>2.4){if(current.trim())lines.push(current.trim());current=str}else current+=(current?' ':'')+str;
    if(Number.isFinite(y))lastY=y;
  }
  if(current.trim())lines.push(current.trim());return clean(lines.join('\n'));
}
function classify(text:string,name:string):Kind{
  if(/Extrato\s+da\s+Duimp|\bDUIMP\b/i.test(text))return'DUIMP';
  if(/\bDANFE\b|Nota Fiscal Eletr[oô]nica|VALOR TOTAL DA NOTA/i.test(text))return'NF-e';
  if(/BILL OF LADING|B\/L\s*No\.?|SHIPPER|CONSIGNEE|SIGNED\s+FOR\s+THE\s+CARRIER|CARRIER:/i.test(text)||/\bBL\b/i.test(name))return'BL';
  if(/\bDARE-SP\b|Documento de Arrecada[cç][aã]o de Receitas Estaduais/i.test(text))return'DARE';
  return'PDF';
}
async function readPdfData(data:ArrayBuffer|Uint8Array,filename:string):Promise<Page[]>{
  const pdf=await getDocument({data}).promise;const pages:Page[]=[];
  for(let i=1;i<=pdf.numPages;i++){
    const p=await pdf.getPage(i);const c=await p.getTextContent();const text=itemsToText(c.items as any[]);
    pages.push({page:i,text,filename,kind:'PDF'});
  }
  const sample=pages.slice(0,Math.min(3,pages.length)).map(p=>p.text).join('\n');const kind=classify(sample,filename);
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
function match(pages:Page[],patterns:RegExp[]):Pick{
  for(const p of pages)for(const re of patterns){const m=p.text.match(re);if(m?.[1])return picked(m[1],p)}return empty();
}
function firstPage(pages:Page[],kind:Kind){return pages.find(p=>p.kind===kind&&p.page===1)||pages.find(p=>p.kind===kind)}

function cliente(pages:Page[]):Pick{
  const duimp=match(pagesOf(pages,'DUIMP'),[/Nome do importador:\s*\n?\s*([^\n]+)/i]);if(duimp.value)return duimp;
  const nf=firstPage(pages,'NF-e');if(nf){const m=nf.text.match(/\n\s*(Iguasport\s+LTDA\.?)\s*\n/i);if(m?.[1])return picked(m[1],nf)}
  return empty();
}
function tipoDocumento(pages:Page[]):Pick{
  const kinds:DocumentKind[]=[...new Set(pages.map(p=>p.kind).filter((k):k is DocumentKind=>k!=='PDF'))];if(!kinds.length)return empty();
  const order:DocumentKind[]=['DUIMP','DARE','BL','NF-e'];const value=order.filter(k=>kinds.includes(k)).join(' + ');const p=pages.find(x=>x.kind!=='PDF')!;
  return{value,source:`Tipos identificados nos ${new Set(pages.map(x=>x.filename)).size} PDF(s) analisados`,confidence:'Alta'};
}
function remetente(pages:Page[]):Pick{
  const duimp=match(pagesOf(pages,'DUIMP'),[/C[oó]digo do Exportador Estrangeiro:\s*\n?\s*(?:OPE_\d+\s*-\s*)?([^\n]+)/i]);if(duimp.value)return duimp;
  const bl=firstPage(pages,'BL');if(bl){const m=bl.text.match(/SHIPPER\s*\n\s*([^\n]+)/i);if(m?.[1])return picked(m[1],bl)}return empty();
}
function blNumber(pages:Page[]):Pick{
  for(const p of pagesOf(pages,'BL')){
    const direct=p.text.match(/B\s*\/\s*L\s*(?:No\.?|N[oº°]\.?|NUMBER)?\s*[:#-]?\s*([A-Z0-9-]{6,20})/i);
    if(direct?.[1]&&!/^(NO|NUMBER)$/i.test(direct[1]))return picked(direct[1],p,'B/L No.');
    const longLabel=p.text.match(/BILL\s+OF\s+LADING\s+(?:NO\.?|NUMBER)\s*[:#-]?\s*([A-Z0-9-]{6,20})/i);
    if(longLabel?.[1])return picked(longLabel[1],p,'Bill of Lading Number');
    const around=p.text.match(/BILL OF LADING NUMBER[\s\S]{0,80}?\b([A-Z0-9-]{6,20})\b/i);
    if(around?.[1]&&!/^(BILL|LADING|NUMBER|VOYAGE)$/i.test(around[1]))return picked(around[1],p);
    const byName=p.filename.match(/(?:^|[-_\s])([A-Z]{2,5}\d{6,10}|\d{7,12})(?=[-_.\s]|$)/i);if(byName?.[1])return picked(byName[1],p,'identificado também pelo nome do arquivo');
  }return empty();
}
function localArmazenagem(pages:Page[]):Pick{
  const r=match(pagesOf(pages,'DUIMP'),[/Local de armazenamento\s*(?:-&gt;|->|:)\s*([^\n]+)/i,/Recinto:\s*\n?\s*([^\n]+)/i]);return r;
}
function refCliente(pages:Page[]):Pick{return match(pages,[/Refer[eê]ncia do cliente\s*(?:-&gt;|->|:)\s*([A-Z0-9./-]+)/i,/Ref\.\s*Cliente\s*:\s*([A-Z0-9./-]+)/i])}
function numeroDocumento(pages:Page[]):Pick{return match(pagesOf(pages,'DUIMP'),[/Extrato da Duimp\s+([0-9A-Z-]{10,25})/i,/\bDUIMP\s*[:.]?\s*([0-9A-Z-]{10,25})/i])}
function destinatario(pages:Page[]):Pick{
  const d=match(pagesOf(pages,'DUIMP'),[/Nome do importador:\s*\n?\s*([^\n]+)/i]);if(d.value)return d;
  const bl=firstPage(pages,'BL');if(bl){const m=bl.text.match(/CONSIGNEE\s*\n\s*([^\n]+)/i);if(m?.[1])return picked(m[1],bl)}return empty();
}
function operacao(pages:Page[]):Pick{
  const duimp=firstPage(pages,'DUIMP');if(duimp)return{value:'Importação',source:`DUIMP · ${duimp.filename} · página ${duimp.page} · Processo de Importação`,confidence:'Alta'};
  const bl=firstPage(pages,'BL');if(bl)return{value:'Importação',source:`BL · ${bl.filename} · página ${bl.page}`,confidence:'Média'};return empty();
}
function agencia(pages:Page[]):Pick{
  for(const p of pagesOf(pages,'BL')){
    let m=p.text.match(/Signed\s+for\s+the\s+Carrier\s*[:\-]?\s*([^\n]{2,80})/i);
    if(m?.[1])return picked(m[1].replace(/^[:\-\s]+|\s+(?:AS\s+AGENTS?|BY)\s*$/gi,'').trim(),p,'Signed for the Carrier');
    m=p.text.match(/as agents for the carrier\s+([^\n]{2,70})/i);if(m?.[1])return picked(m[1].replace(/\s+BY\s*$/i,'').trim(),p,'carrier/agente marítimo');
    m=p.text.match(/CARRIER:\s*\n?\s*([^\n]{2,80})/i);if(m?.[1])return picked(m[1].replace(/Soci[eé]t[eé].*$/i,'').trim(),p,'carrier/agente marítimo');
  }return empty();
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