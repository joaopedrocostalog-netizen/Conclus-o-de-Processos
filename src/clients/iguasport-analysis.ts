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
  if(/Extrato\s+da\s+Duimp|\bDUIMP\b/i.test(text))return'DUIMP';
  if(/\bDANFE\b|Nota Fiscal Eletr[oô]nica|VALOR TOTAL DA NOTA/i.test(text))return'NF-e';
  if(/BILL OF LADING|B\s*\/\s*L\s*No\.?|SHIPPER|CONSIGNEE|SIGNED\s+FOR\s+THE\s+CARRIER|AGENTS?\s+FOR\s+THE\s+CARRIER|CARRIER:/i.test(text)||/\bBL\b/i.test(name))return'BL';
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
function blLikePages(pages:Page[]){return pages.filter(p=>p.kind==='BL'||/BILL OF LADING|B\s*\/\s*L\s*No\.?|SIGNED\s+FOR\s+THE\s+CARRIER|AGENTS?\s+FOR\s+THE\s+CARRIER|\bSHIPPER\b|\bCONSIGNEE\b/i.test(`${p.text} ${p.flatText}`))}
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
    .replace(/\s+(?:WOODEN PACKING|CNPJ|CPF|NCM|ADDRESS|ENDEREÇO|TEL|PHONE|CONSIGNEE|NOTIFY PARTY|SHIPPER|PRE CARRIAGE|PLACE OF RECEIPT|VESSEL|PORT OF|FREIGHT)\b.*$/i,'')
    .replace(/[|·]+$/g,'')
    .trim();
}
function remetente(pages:Page[]):Pick{
  for(const p of blLikePages(pages)){
    for(const row of p.rows){
      const m=row.match(/\bEXPORTER\s*:\s*(.+)$/i);
      if(m?.[1]){const value=cleanParty(m[1]);if(value.length>=3)return picked(value,p,'EXPORTER no BL')}
    }
    const combined=`${p.text}\n${p.flatText}`;
    const exporter=combined.match(/\bEXPORTER\s*:\s*([A-Z0-9][A-Z0-9 .,&'()\/-]{2,90}?)(?=\s+(?:WOODEN PACKING|CNPJ|CPF|NCM|1\s*X\s*\d|SAY\b|SHIPPER\b|CONSIGNEE\b|NOTIFY\b)|$)/i);
    if(exporter?.[1]){const value=cleanParty(exporter[1]);if(value.length>=3)return picked(value,p,'EXPORTER no BL')}
  }
  const duimp=match(pagesOf(pages,'DUIMP'),[/C[oó]digo do Exportador Estrangeiro:\s*\n?\s*(?:OPE_\d+\s*-\s*)?([^\n]+)/i]);if(duimp.value)return duimp;
  return empty('Remetente / Exportador não localizado no BL nem na DUIMP da IGUASPORT');
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
    .replace(/\s+(?:PLACE AND DATE|SIGNED FOR THE SHIPPER|VOYAGE NUMBER|BILL OF LADING|VESSEL|PORT OF|KGS|CBM)\b.*$/i,'')
    .replace(/^[|·_]+|[|·_]+$/g,'')
    .replace(/\s{2,}/g,' ')
    .trim();
}
function companyFromCarrierTail(tail:string){
  const normalized=one(tail).replace(/^[:\-\s]+/,'');
  const suffixed=normalized.match(/^(.{2,80}?(?:A\/S|S\.?\s*A\.?|LTD\.?|LIMITED|INC\.?|CORP\.?|CO\.?|LLC|LINE(?:S)?|SHIPPING|MARITIME))(?=\s+(?:BY\b|PLACE\b|DATE\b|VESSEL\b|PORT\b|KGS\b|CBM\b)|$)/i);
  if(suffixed?.[1])return cleanAgency(suffixed[1]);
  const untilBy=normalized.match(/^(.{2,80}?)(?=\s+BY\b)/i);if(untilBy?.[1])return cleanAgency(untilBy[1]);
  return '';
}
function plausibleAgency(value:string){return value.length>=2&&!/^(BY|SIGNATURE|PLACE|DATE|DRAFT|KGS|CBM|VOYAGE|VESSEL)$/i.test(value)&&!/^_{3,}$/.test(value)}
function agencia(pages:Page[]):Pick{
  for(const p of blLikePages(pages)){
    for(const row of p.rows){
      let m=row.match(/SIGNED\s+FOR\s+THE\s+CARRIER\s*[:\-]?\s*(.+)$/i);
      if(m?.[1]){const value=cleanAgency(m[1]);if(plausibleAgency(value))return picked(value,p,'Signed for the Carrier')}
      m=row.match(/AS\s+AGENTS?\s+FOR\s+THE\s+CARRIER\s*[:\-]?\s*(.+)$/i);
      if(m?.[1]){const value=cleanAgency(m[1]);if(plausibleAgency(value))return picked(value,p,'as agents for the carrier')}
    }
    const sources=[p.text,p.flatText];
    for(const source of sources){
      for(const anchor of [/SIGNED\s+FOR\s+THE\s+CARRIER\s*[:\-]?/ig,/AS\s+AGENTS?\s+FOR\s+THE\s+CARRIER\s*[:\-]?/ig]){
        anchor.lastIndex=0;let m:RegExpExecArray|null;
        while((m=anchor.exec(source))){
          const value=companyFromCarrierTail(source.slice(m.index+m[0].length,m.index+m[0].length+140));
          if(plausibleAgency(value))return picked(value,p,/SIGNED/i.test(m[0])?'Signed for the Carrier':'as agents for the carrier');
        }
      }
      const known=source.match(/\b(MAERSK\s+A\/S|CMA\s+CGM\s+S\.?\s*A\.?|MSC(?:\s+[A-Z][A-Z .&'-]{1,35})?|HAPAG[- ]LLOYD(?:\s+[A-Z .&'-]{1,30})?|COSCO(?:\s+SHIPPING)?(?:\s+[A-Z .&'-]{1,30})?|EVERGREEN(?:\s+MARINE)?(?:\s+[A-Z .&'-]{1,30})?|YANG\s+MING(?:\s+[A-Z .&'-]{1,30})?|ZIM(?:\s+[A-Z .&'-]{1,30})?)\b/i);
      if(known?.[1]&&/SIGNED\s+FOR\s+THE\s+CARRIER|AGENTS?\s+FOR\s+THE\s+CARRIER/i.test(source))return picked(cleanAgency(known[1]),p,'carrier identificado no BL');
    }
  }
  return empty('Agência marítima não localizada junto de “Signed for the Carrier” no BL da IGUASPORT');
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
