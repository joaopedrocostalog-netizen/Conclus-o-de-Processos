import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import JSZip from 'jszip';
import type { XcmgSpreadsheetSnapshot } from './xcmg-spreadsheet';

GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();

export const XCMG_REPORT_FIELDS=Object.freeze([
  'Cliente','Tipo Documento','Remetente / Exportador','Nº BL / AWB','Local de Armazenagem','Ref. do Cliente','Nº Documento','Destinatário / Importador','Operação Marítima','Agência Marítima','CNPJ do Cliente / Importador','Contêineres','Peso Líquido','Valor Total da Nota'
] as const);

export type XcmgReportFieldLabel=typeof XCMG_REPORT_FIELDS[number];
export type XcmgAnalysisField={label:XcmgReportFieldLabel;value:string;source:string;confidence:'Alta'|'Média'|'Baixa'};
export type XcmgAnalysisSnapshot={client:'XCMG';processType:'Importação';summary:string;fields:XcmgAnalysisField[];found:number;total:number};

type PdfPage={filename:string;page:number;rows:string[];text:string;flatText:string};
type Pick={value:string|null;source:string;confidence:'Alta'|'Média'|'Baixa'};

const clean=(value:string)=>value.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const one=(value:string)=>clean(value).replace(/\n/g,' ').trim();
const empty=(why='Não localizado nos arquivos enviados para a XCMG'):Pick=>({value:null,source:why,confidence:'Baixa'});
const pdfSource=(p:PdfPage,note:string)=>`NF · ${p.filename} · página ${p.page} · ${note}`;
const sheetSource=(filename:string,sheet:string,cells:string,note:string)=>`Excel · ${filename} · aba ${sheet} · ${cells} · ${note}`;

function colName(index:number){let n=index+1,out='';while(n){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26)}return out}
function cellRef(row:number,col:number){return`${colName(col)}${row+1}`}
function itemsToRows(items:any[]):string[]{
  const cells=items.filter(raw=>raw&&'str' in raw&&String(raw.str||'').trim()).map((raw:any)=>({str:String(raw.str||'').trim(),x:Number(raw.transform?.[4]||0),y:Number(raw.transform?.[5]||0)}));
  const groups:Array<{y:number;cells:typeof cells}>=[];
  for(const cell of cells){let group=groups.find(g=>Math.abs(g.y-cell.y)<=2.8);if(!group){group={y:cell.y,cells:[]};groups.push(group)}group.cells.push(cell)}
  return groups.sort((a,b)=>b.y-a.y).map(g=>g.cells.sort((a,b)=>a.x-b.x).map(c=>c.str).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean);
}
async function readPdf(data:ArrayBuffer|Uint8Array,filename:string):Promise<PdfPage[]>{
  const pdf=await getDocument({data}).promise;const pages:PdfPage[]=[];
  for(let i=1;i<=pdf.numPages;i++){
    const p=await pdf.getPage(i);const c=await p.getTextContent();const items=c.items as any[];const rows=itemsToRows(items);
    pages.push({filename,page:i,rows,text:clean(rows.join('\n')),flatText:clean(items.filter(raw=>raw&&'str' in raw).map((raw:any)=>String(raw.str||'').trim()).filter(Boolean).join(' '))});
  }
  return pages;
}
async function readSupport(nfs:File[],zip:File|null){
  const out:PdfPage[]=[];
  if(nfs.length){
    for(const nf of nfs)out.push(...await readPdf(await nf.arrayBuffer(),nf.name));
    return out;
  }
  if(!zip)throw new Error('Envie uma ou mais NFs em PDF ou um ZIP para a XCMG.');
  const archive=await JSZip.loadAsync(await zip.arrayBuffer());
  const entries=Object.values(archive.files).filter(entry=>!entry.dir&&entry.name.toLowerCase().endsWith('.pdf'));
  if(!entries.length)throw new Error('Nenhum PDF foi encontrado dentro do ZIP da XCMG.');
  for(const entry of entries)out.push(...await readPdf(await entry.async('uint8array'),entry.name));
  return out;
}
function nfePages(pages:PdfPage[]){return pages.filter(p=>/\bDANFE\b|NOTA FISCAL ELETR[OÔ]NICA|VALOR TOTAL DA NOTA|CHAVE DE ACESSO/i.test(`${p.text} ${p.flatText}`))}
function firstNfe(pages:PdfPage[]){return nfePages(pages)[0]||pages[0]}
function companyRows(p:PdfPage){return p.rows.map(row=>one(row)).filter(Boolean)}
function clientName(pages:PdfPage[]):Pick{
  for(const p of nfePages(pages))for(const row of companyRows(p)){
    if(/^XCMG\b/i.test(row)&&/\bLTDA\b/i.test(row)&&!/CONSTRUCTION/i.test(row))return{value:row,source:pdfSource(p,'emitente / cabeçalho da NF'),confidence:'Alta'};
  }
  return empty('Nome completo do cliente não localizado no cabeçalho da NF.');
}
function exporter(pages:PdfPage[]):Pick{
  for(const p of nfePages(pages)){
    const rows=companyRows(p);const marker=rows.findIndex(row=>/DESTINAT[ÁA]RIO\s*\/\s*REMETENTE/i.test(row));
    if(marker<0)continue;
    for(const row of rows.slice(marker+1,marker+8)){
      if(/^(NOME\/RAZ[AÃ]O SOCIAL|CNPJ|CPF|ENDERE[CÇ]O|BAIRRO|MUNIC[IÍ]PIO|FONE|DATA|CEP|UF)\b/i.test(row))continue;
      if(/^XCMG\b/i.test(row))return{value:row,source:pdfSource(p,'DESTINATÁRIO / REMETENTE'),confidence:'Alta'};
    }
  }
  return empty('Remetente / Exportador não localizado na área DESTINATÁRIO / REMETENTE da NF.');
}
function storage(pages:PdfPage[]):Pick{
  for(const p of nfePages(pages)){
    const all=one(`${p.text} ${p.flatText}`);const m=all.match(/Recinto\s+Alfandegado\s*:\s*(?:\[[^\]]+\]\s*-?\s*)?(.+?)(?=\s+Ref\.\s*Cliente\s*:|\s+Faturas\s*->|\s+Ref\.\s*Despachante|$)/i);
    if(m?.[1])return{value:one(m[1]).replace(/^[-:\s]+/,''),source:pdfSource(p,'Recinto Alfandegado'),confidence:'Alta'};
  }
  return empty('Local de Armazenagem não localizado em Recinto Alfandegado na NF.');
}
function clientRef(pages:PdfPage[]):Pick{
  for(const p of nfePages(pages)){const m=one(`${p.text} ${p.flatText}`).match(/Ref\.\s*Cliente\s*:\s*([A-Z0-9./_-]+)/i);if(m?.[1])return{value:m[1],source:pdfSource(p,'Ref. Cliente'),confidence:'Alta'}}
  return empty('Ref. do Cliente não localizada na NF.');
}
function declaration(pages:PdfPage[]):Pick{
  for(const p of nfePages(pages)){const m=one(`${p.text} ${p.flatText}`).match(/N[uú]mero\s+da\s+Declara[cç][aã]o\s*:\s*([A-Z0-9.-]+)/i);if(m?.[1])return{value:m[1],source:pdfSource(p,'Número da Declaração'),confidence:'Alta'}}
  return empty('Número da Declaração não localizado na NF.');
}
function importer(pages:PdfPage[]):Pick{return clientName(pages)}
function importerCnpj(pages:PdfPage[]):Pick{
  const cnpj=/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/;
  for(const p of nfePages(pages)){
    if(p.page!==1)continue;
    const rows=companyRows(p);
    const recipientIndex=rows.findIndex(row=>/DESTINAT[ÁA]RIO\s*\/\s*REMETENTE/i.test(row));
    const headerRows=recipientIndex>0?rows.slice(0,recipientIndex):rows.slice(0,30);
    for(let i=0;i<headerRows.length;i++){
      if(!/^CNPJ\b/i.test(headerRows[i])&&!/\bCNPJ\b/i.test(headerRows[i]))continue;
      for(let j=i;j<=Math.min(headerRows.length-1,i+2);j++){
        const m=headerRows[j].match(cnpj);if(m)return{value:m[0],source:pdfSource(p,'CNPJ do cabeçalho superior direito do DANFE'),confidence:'Alta'};
      }
    }
    for(const row of headerRows){const m=row.match(cnpj);if(m)return{value:m[0],source:pdfSource(p,'CNPJ do cabeçalho superior direito do DANFE'),confidence:'Alta'}}
  }
  return empty('CNPJ do Cliente / Importador não localizado no cabeçalho superior direito da NF.');
}
function parsePtBrNumber(value:string){const parsed=Number(value.replace(/\./g,'').replace(',','.'));return Number.isFinite(parsed)?parsed:null}
function formatPtBr(value:number,decimals:number){return new Intl.NumberFormat('pt-BR',{minimumFractionDigits:decimals,maximumFractionDigits:decimals,useGrouping:true}).format(value)}
function pagesByFile(pages:PdfPage[]){const map=new Map<string,PdfPage[]>();for(const page of nfePages(pages)){const current=map.get(page.filename)||[];current.push(page);map.set(page.filename,current)}return map}
function netWeight(pages:PdfPage[]):Pick{
  const found:Array<{value:number;display:string;page:PdfPage}>=[];
  for(const [,filePages] of pagesByFile(pages)){
    let fileHit:{value:number;display:string;page:PdfPage}|null=null;
    for(const p of filePages){
      const rows=companyRows(p);const marker=rows.findIndex(row=>/PESO\s+BRUTO.*PESO\s+L[IÍ]QUIDO/i.test(row)||/PESO\s+L[IÍ]QUIDO/i.test(row));
      if(marker<0)continue;
      for(const row of rows.slice(marker+1,marker+7)){
        const nums=[...row.matchAll(/\b\d{1,9}(?:\.\d{3})*,\d{3}\b/g)].map(m=>m[0]);
        if(!nums.length)continue;
        const display=nums[nums.length-1],value=parsePtBrNumber(display);
        if(value!==null){fileHit={value,display,page:p};break}
      }
      if(fileHit)break;
    }
    if(fileHit)found.push(fileHit);
  }
  if(!found.length)return empty('Peso Líquido não localizado nas NFs.');
  const total=found.reduce((sum,item)=>sum+item.value,0);
  const source=found.length===1
    ?pdfSource(found[0].page,'PESO LÍQUIDO')
    :`Soma de ${found.length} NFs · ${found.map(item=>`${item.page.filename} · página ${item.page.page} · ${item.display}`).join(' + ')}`;
  return{value:formatPtBr(total,3),source,confidence:'Alta'};
}
function noteValue(pages:PdfPage[]):Pick{
  const found:Array<{value:number;display:string;page:PdfPage}>=[];
  for(const [,filePages] of pagesByFile(pages)){
    let fileHit:{value:number;display:string;page:PdfPage}|null=null;
    for(const p of filePages){
      const rows=companyRows(p);const marker=rows.findIndex(row=>/VALOR\s+TOTAL\s+DA\s+NOTA/i.test(row));if(marker<0)continue;
      const candidates:string[]=[];
      for(const row of rows.slice(marker,marker+6))for(const m of row.matchAll(/\b\d{1,3}(?:\.\d{3})*,\d{2}\b/g))candidates.push(m[0]);
      if(candidates.length){
        const ranked=candidates.map(display=>({display,value:parsePtBrNumber(display)})).filter((item):item is {display:string;value:number}=>item.value!==null).sort((x,y)=>y.value-x.value);
        if(ranked.length){fileHit={...ranked[0],page:p};break}
      }
    }
    if(fileHit)found.push(fileHit);
  }
  if(!found.length)return empty('Valor Total da Nota não localizado nas NFs.');
  const total=found.reduce((sum,item)=>sum+item.value,0);
  const source=found.length===1
    ?pdfSource(found[0].page,'VALOR TOTAL DA NOTA')
    :`Soma de ${found.length} NFs · ${found.map(item=>`${item.page.filename} · página ${item.page.page} · R$ ${item.display}`).join(' + ')}`;
  return{value:formatPtBr(total,2),source,confidence:'Alta'};
}
function blNumber(sheet:XcmgSpreadsheetSnapshot):Pick{
  for(const sh of sheet.sheets)for(let r=0;r<sh.rows.length;r++){
    const row=sh.rows[r];for(let c=0;c<row.length;c++){
      if(!/\bBL\s*NO\.?\s*:/i.test(row[c]||''))continue;
      for(let j=c;j<Math.min(row.length,c+5);j++){
        const m=String(row[j]||'').match(/\b[A-Z]{3,6}\d{7,14}\b/i);if(m)return{value:m[0],source:sheetSource(sheet.filename,sh.name,cellRef(r,j),'BL NO.'),confidence:'Alta'};
      }
    }
  }
  return empty('Nº BL / AWB não localizado na planilha.');
}
function containers(sheet:XcmgSpreadsheetSnapshot):Pick{
  const values:Array<{value:string;sheet:string;ref:string}>=[];
  for(const sh of sheet.sheets){
    for(let r=0;r<sh.rows.length;r++){
      for(let c=0;c<sh.rows[r].length;c++){
        const raw=String(sh.rows[r]?.[c]||'').toUpperCase();
        for(const match of raw.matchAll(/\b[A-Z]{4}\d{7}\b/g)){
          values.push({value:match[0],sheet:sh.name,ref:cellRef(r,c)});
        }
      }
    }
  }
  if(!values.length)return empty('Contêineres não localizados na planilha.');
  const unique=[...new Map(values.map(item=>[item.value,item])).values()];
  const refsBySheet=new Map<string,string[]>();
  for(const item of unique){const refs=refsBySheet.get(item.sheet)||[];refs.push(item.ref);refsBySheet.set(item.sheet,refs)}
  const sourceParts=[...refsBySheet.entries()].map(([sheet,refs])=>`aba ${sheet} · ${refs.join(', ')}`);
  return{
    value:unique.map(item=>item.value).join(', '),
    source:`Excel · ${sheet.filename} · ${sourceParts.join(' · ')} · todos os contêineres identificados`,
    confidence:'Alta'
  };
}
function toField(label:XcmgReportFieldLabel,pick:Pick):XcmgAnalysisField{return{label,value:pick.value||'—',source:pick.source,confidence:pick.confidence}}

export async function runXcmgAnalysis(args:{spreadsheet:XcmgSpreadsheetSnapshot;nfs:File[];zip:File|null}):Promise<XcmgAnalysisSnapshot>{
  const pages=await readSupport(args.nfs,args.zip);const client=clientName(pages);
  const picks:Record<XcmgReportFieldLabel,Pick>={
    'Cliente':client,
    'Tipo Documento':{value:'DUIMP',source:'Regra exclusiva XCMG · tipo de documento definido para este cliente',confidence:'Alta'},
    'Remetente / Exportador':exporter(pages),
    'Nº BL / AWB':blNumber(args.spreadsheet),
    'Local de Armazenagem':storage(pages),
    'Ref. do Cliente':clientRef(pages),
    'Nº Documento':declaration(pages),
    'Destinatário / Importador':importer(pages),
    'Operação Marítima':{value:'Importação',source:'Regra exclusiva XCMG · operação definida para este cliente',confidence:'Alta'},
    'Agência Marítima':{value:'—',source:'Campo ainda não configurado na lógica XCMG',confidence:'Baixa'},
    'CNPJ do Cliente / Importador':importerCnpj(pages),
    'Contêineres':containers(args.spreadsheet),
    'Peso Líquido':netWeight(pages),
    'Valor Total da Nota':noteValue(pages)
  };
  const fields=XCMG_REPORT_FIELDS.map(label=>toField(label,picks[label]));const found=fields.filter(field=>field.value!=='—').length;
  return{client:'XCMG',processType:'Importação',summary:`${found}/${fields.length} campos localizados nos arquivos enviados`,fields,found,total:fields.length};
}
