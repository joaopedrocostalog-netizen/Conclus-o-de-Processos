import { useMemo, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { createWorker } from 'tesseract.js';
import { AlertTriangle, Check, ChevronRight, Clipboard, FilePlus2, FileText, Loader2, RotateCcw, Sparkles, X, Zap } from 'lucide-react';
import './styles.css';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

type Confidence='high'|'medium'|'low';
type Field={key:string;label:string;value:string|null;confidence:Confidence;page:number|null;source:string;edited?:boolean};
type PdfPage={page:number;text:string;ocr:boolean;document:'DOC COMPLETO'|'NF FISCAL'};
type ReadResult={pages:PdfPage[];total:number;name:string;kind:'DOC COMPLETO'|'NF FISCAL'};
type Analysis={process_type:'IMPORTAÇÃO'|'EXPORTAÇÃO'|'NÃO IDENTIFICADO';fields:Field[];pages:number;filename:string;ocr_pages:string[];documents:string[]};

const labels:Record<string,string>={
 cliente:'Cliente',
 tipo_documento:'Tipo Documento',
 remetente:'Remetente / Exportador',
 numero_bl_awb:'Nº BL / AWB',
 local_armazenagem:'Local de Armazenagem',
 ref_cliente:'Ref. do Cliente',
 numero_documento:'Nº Documento',
 destinatario:'Destinatário / Importador',
 operacao_maritima:'Operação Marítima',
 cnpj_cliente:'CNPJ do Cliente / Importador',
 conteineres:'Contêineres',
 peso_liquido:'Peso Líquido',
 valor_total_nota:'Valor Total da Nota'
};
const keys=Object.keys(labels);
const clean=(s:string)=>s.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const one=(s:string)=>clean(s).replace(/\n/g,' ').trim();
const norm=(s:string|null)=>one(s||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,'');
const normCnpj=(s:string|null)=>one(s||'').replace(/\D/g,'');

function textItemsToLines(items:any[]):string{
 let lastY:number|null=null,current=''; const lines:string[]=[];
 for(const raw of items){
  if(!('str' in raw))continue;
  const item=raw as TextItem;
  const str=item.str?.trim();
  if(!str)continue;
  const y=Array.isArray((item as any).transform)?Number((item as any).transform[5]):null;
  if(lastY!==null&&y!==null&&Math.abs(y-lastY)>2.4){if(current.trim())lines.push(current.trim());current=str}else current+=(current?' ':'')+str;
  if(y!==null)lastY=y;
 }
 if(current.trim())lines.push(current.trim());
 return clean(lines.join('\n'));
}

async function ocrPage(page:any):Promise<string>{
 const viewport=page.getViewport({scale:2.7});
 const canvas=document.createElement('canvas');
 canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
 const ctx=canvas.getContext('2d');if(!ctx)return'';
 await page.render({canvasContext:ctx,viewport}).promise;
 const worker=await createWorker('eng+por');
 try{
  await worker.setParameters({preserve_interword_spaces:'1'});
  const r=await worker.recognize(canvas);
  return clean(r.data.text||'');
 }finally{await worker.terminate()}
}

async function readPdf(file:File,kind:ReadResult['kind']):Promise<ReadResult>{
 const pdf=await getDocument({data:await file.arrayBuffer()}).promise;
 const pages:PdfPage[]=[];
 for(let i=1;i<=pdf.numPages;i++){
  const p=await pdf.getPage(i);
  const content=await p.getTextContent();
  let text=textItemsToLines(content.items as any[]);
  let ocr=false;
  const sparse=text.replace(/\s/g,'').length<35;
  if(i===1||sparse){
   try{
    const o=await ocrPage(p);
    if(o.length>20){text=clean(`${text}\n${o}`);ocr=true}
   }catch{}
  }
  pages.push({page:i,text,ocr,document:kind});
 }
 return{pages,total:pdf.numPages,name:file.name,kind};
}

function result(value:string|null,page:number|null,source:string,confidence:Confidence='high'){
 return{value,page,source,confidence:value?confidence:'low' as Confidence};
}

function find(pages:PdfPage[],patterns:RegExp[],preferred:number[]=[]):ReturnType<typeof result>{
 const ordered=[...preferred.flatMap(n=>pages.filter(p=>p.page===n)),...pages.filter(p=>!preferred.includes(p.page))];
 for(const p of ordered){
  for(const re of patterns){
   const m=p.text.match(re);
   if(m?.[1])return result(one(m[1]),p.page,`${p.document} · página ${p.page}: ${one(m[1])}`);
  }
 }
 return result(null,null,'Não localizado nos PDFs analisados','low');
}

function pageLines(p?:PdfPage){return p?p.text.split(/\n+/).map(one).filter(Boolean):[]}

function afterLabel(p:PdfPage|undefined,label:RegExp,skip:RegExp[]=[]):ReturnType<typeof result>{
 if(!p)return result(null,null,'Página não disponível','low');
 const ls=pageLines(p);
 for(let i=0;i<ls.length;i++){
  if(!label.test(ls[i]))continue;
  const same=ls[i].replace(label,'').replace(/^\s*[:\-]\s*/,'').trim();
  if(same.length>2&&!skip.some(r=>r.test(same)))return result(same,p.page,`${p.document} · página ${p.page}: ${same}`);
  for(let j=i+1;j<Math.min(i+8,ls.length);j++){
   const c=ls[j];
   if(c.length<2||skip.some(r=>r.test(c)))continue;
   return result(c,p.page,`${p.document} · página ${p.page}: ${c}`);
  }
 }
 return result(null,null,`${p.document} · página ${p.page}: campo não localizado`,'low');
}

function normalizeCompany(v:string|null){
 return v?one(v).replace(/^OPE_\d+\s*-\s*/i,'').replace(/\s+(CNPJ|TAX ID|ADDRESS|ENDERE[CÇ]O|ZIP CODE).*$/i,'').trim():null;
}
function normalizeContainers(v:string|null){
 if(!v)return null;
 const a=[...v.matchAll(/\b[A-Z]{4}\s*\d{7}\b/gi)].map(m=>m[0].replace(/\s/g,'').toUpperCase());
 return a.length?[...new Set(a)].join(' / '):one(v);
}
function normalizeBL(v:string|null){return v?v.replace(/[^A-Z0-9]/gi,'').toUpperCase():null}
function formatCnpj(v:string|null){
 const d=normCnpj(v);if(d.length!==14)return v;
 return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

function customerFromDoc(p?:PdfPage){
 const r=afterLabel(p,/For\s+delivery\s+of\s+goods\s+please\s+apply\s+to\s*:?/i,[/CNPJ|ZIP|AVENIDA|STREET|RUA|PORT OF|B\/L/i]);
 if(r.value)r.value=normalizeCompany(r.value);
 return r;
}

function customerFromNf(p?:PdfPage){
 if(!p)return result(null,null,'NF Fiscal não enviada','low');
 const ls=pageLines(p);let inTransport=false;
 for(let i=0;i<ls.length;i++){
  if(/TRANSPORTADOR\s*\/\s*VOLUMES\s*TRANSPORTADOS/i.test(ls[i]))inTransport=true;
  if(inTransport&&/RAZ[AÃ]O\s+SOCIAL/i.test(ls[i])){
   const same=ls[i].replace(/.*RAZ[AÃ]O\s+SOCIAL\s*/i,'').trim();
   if(same.length>3&&!/FRETE|CNPJ|ENDERE[CÇ]O/i.test(same))return result(normalizeCompany(same),p.page,`NF FISCAL · página 1: Transportador / Razão Social = ${same}`);
   for(let j=i+1;j<Math.min(i+5,ls.length);j++){
    const c=ls[j];
    if(/ENDERE[CÇ]O|FRETE|CNPJ|QUANTIDADE|ESP[EÉ]CIE/i.test(c))continue;
    if(c.length>3)return result(normalizeCompany(c),p.page,`NF FISCAL · página 1: Transportador / Razão Social = ${c}`);
   }
  }
 }
 return find([p],[/TRANSPORTADOR[\s\S]{0,260}?RAZ[AÃ]O SOCIAL\s*\n?\s*([^\n]+)/i],[1]);
}

function cnpjFromDoc(p?:PdfPage){
 if(!p)return result(null,null,'DOC COMPLETO não enviado','low');
 const m=p.text.match(/For\s+delivery\s+of\s+goods\s+please\s+apply\s+to[\s\S]{0,600}?CNPJ\s*(?:NO\.?)?\s*[:.]?\s*([0-9./-]{14,20})/i);
 return m?.[1]?result(formatCnpj(m[1]),p.page,`DOC COMPLETO · página 1 · bloco “For delivery of goods please apply to”: CNPJ ${formatCnpj(m[1])}`):result(null,null,'CNPJ do cliente não localizado no bloco de entrega da página 1','low');
}

function cnpjFromNf(p?:PdfPage){
 if(!p)return result(null,null,'NF Fiscal não enviada','low');
 const text=p.text;
 const m=text.match(/TRANSPORTADOR\s*\/\s*VOLUMES\s*TRANSPORTADOS[\s\S]{0,700}?CNPJ\s*(?:\/\s*CPF)?\s*[:.]?\s*([0-9./-]{14,20})/i);
 if(m?.[1])return result(formatCnpj(m[1]),p.page,`NF FISCAL · página 1 · Transportador / CNPJ-CPF: ${formatCnpj(m[1])}`);
 const all=[...text.matchAll(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/g)];
 return all.length?result(formatCnpj(all[all.length-1][1]),p.page,`NF FISCAL · página 1 · CNPJ no bloco do transportador: ${formatCnpj(all[all.length-1][1])}`):result(null,null,'CNPJ do transportador não localizado na página 1 da NF','low');
}

function totalFromNf(p?:PdfPage){
 if(!p)return result(null,null,'NF Fiscal não enviada','low');
 const direct=p.text.match(/VALOR\s+TOTAL\s+DA\s+NOTA\s*[:\-]?\s*(?:R\$\s*)?([0-9.]+,[0-9]{2})/i);
 if(direct?.[1])return result(`R$ ${direct[1]}`,p.page,`NF FISCAL · página 1 · VALOR TOTAL DA NOTA: R$ ${direct[1]}`);
 const ls=pageLines(p);
 for(let i=0;i<ls.length;i++){
  if(!/VALOR\s+TOTAL\s+DA\s+NOTA/i.test(ls[i]))continue;
  const same=ls[i].match(/([0-9.]+,[0-9]{2})/);
  if(same?.[1])return result(`R$ ${same[1]}`,p.page,`NF FISCAL · página 1 · VALOR TOTAL DA NOTA: R$ ${same[1]}`);
  for(let j=i+1;j<Math.min(i+4,ls.length);j++){
   const m=ls[j].match(/([0-9.]+,[0-9]{2})/);
   if(m?.[1])return result(`R$ ${m[1]}`,p.page,`NF FISCAL · página 1 · VALOR TOTAL DA NOTA: R$ ${m[1]}`);
  }
 }
 return result(null,null,'VALOR TOTAL DA NOTA não localizado na página 1 da NF','low');
}

function analyzeDocuments(results:ReadResult[]):Analysis{
 const all=results.flatMap(r=>r.pages);
 const doc=results.find(r=>r.kind==='DOC COMPLETO'),nf=results.find(r=>r.kind==='NF FISCAL');
 const docPages=doc?.pages||[],nfPages=nf?.pages||[];
 const doc1=docPages.find(p=>p.page===1),nf1=nfPages.find(p=>p.page===1);
 const full=all.map(p=>p.text).join('\n');
 const values:Record<string,ReturnType<typeof result>>={};
 const processType:'IMPORTAÇÃO'|'EXPORTAÇÃO'|'NÃO IDENTIFICADO'=/\bDUIMP\b|Nome do importador|Importa[cç][aã]o/i.test(full)?'IMPORTAÇÃO':(/\bDUE\b|Nome do exportador|Exporta[cç][aã]o/i.test(full)?'EXPORTAÇÃO':'NÃO IDENTIFICADO');

 // CLIENTE: DOC COMPLETO p.1 = "For delivery..."; NF p.1 = Transportador / Razão Social.
 const cd=customerFromDoc(doc1),cn=customerFromNf(nf1);
 if(cd.value&&cn.value){
  const same=norm(cd.value)===norm(cn.value);
  values.cliente=result(cd.value,1,same?`Confirmado nos 2 PDFs: DOC COMPLETO = ${cd.value} | NF FISCAL = ${cn.value}`:`Divergência: DOC COMPLETO = ${cd.value} | NF FISCAL = ${cn.value}`,same?'high':'medium');
 }else values.cliente=cd.value?cd:cn;

 const hasDuimp=/Extrato da Duimp|\bDUIMP\b/i.test(full),hasDue=/\bDUE\b/i.test(full),hasNfe=/\bDANFE\b|NF-?e|NOTA FISCAL ELETR[ÔO]NICA/i.test(full);
 values.tipo_documento=result([hasDuimp?'DUIMP':null,hasDue?'DUE':null,hasNfe?'NF-e':null].filter(Boolean).join(' + ')||(/BILL OF LADING|B\/L/i.test(full)?'BL':null),hasDuimp?4:1,'Tipo identificado diretamente nos documentos');

 values.remetente=afterLabel(doc1,/\bConsignor\s*\/\s*Shipper\b/i,[/Port of Loading|Consignee|Notify|B\/L|Bill of Lading|Address/i]);
 if(!values.remetente.value)values.remetente=find(docPages,[/C[oó]digo do Exportador Estrangeiro:\s*\n?\s*(?:OPE_\d+\s*-\s*)?([^\n]+)/i],[1]);
 if(values.remetente.value)values.remetente.value=normalizeCompany(values.remetente.value);

 values.numero_bl_awb=find(docPages,[/Conhecimento\.{0,10}:\s*([A-Z0-9-]{8,})/i,/B\/?L(?:\s*(?:No|Nº|NUMBER))?\s*[:#-]?\s*([A-Z0-9-]{8,})/i],[1,4]);
 if(values.numero_bl_awb.value)values.numero_bl_awb.value=normalizeBL(values.numero_bl_awb.value);

 values.local_armazenagem=find(docPages,[/Recinto Alfandeg[aá]rio\.{0,10}:\s*([^\n]+)/i,/Setor Alfandeg[aá]rio\.{0,10}:\s*([^\n]+)/i],[4,5]);
 values.ref_cliente=find(docPages,[/REF\.?\s*IMPORTADOR\.{0,10}:\s*([A-Z0-9./-]+)/i,/Nossa Refer[eê]ncia\.{0,10}:\s*([A-Z0-9./-]+)/i],[4]);
 values.numero_documento=find(docPages,[/Extrato da Duimp\s+([0-9A-Z-]{10,25})/i,/\bDUIMP\s*[:.]?\s*([0-9A-Z-]{10,25})/i,/\bDUE\s*[:.]?\s*([0-9A-Z-]{10,25})/i],[4]);
 values.destinatario=find(docPages,[/Nome do importador:\s*\n?\s*([^\n]+)/i,/Consignee[^\n]*\n\s*([^\n]+)/i],[4,1]);
 if(values.destinatario.value)values.destinatario.value=normalizeCompany(values.destinatario.value);

 values.operacao_maritima=result(processType==='IMPORTAÇÃO'?'Importação':processType==='EXPORTAÇÃO'?'Exportação':null,values.numero_documento.page,'Operação definida pelo documento aduaneiro');

 // CNPJ CLIENTE: cruza o bloco da página 1 do DOC COMPLETO com CNPJ/CPF do transportador na página 1 da NF.
 const cnpjDoc=cnpjFromDoc(doc1),cnpjNf=cnpjFromNf(nf1);
 if(cnpjDoc.value&&cnpjNf.value){
  const same=normCnpj(cnpjDoc.value)===normCnpj(cnpjNf.value);
  values.cnpj_cliente=result(cnpjDoc.value,1,same?`Confirmado nos 2 PDFs: DOC COMPLETO = ${cnpjDoc.value} | NF FISCAL = ${cnpjNf.value}`:`Divergência de CNPJ: DOC COMPLETO = ${cnpjDoc.value} | NF FISCAL = ${cnpjNf.value}`,same?'high':'medium');
 }else values.cnpj_cliente=cnpjDoc.value?cnpjDoc:cnpjNf;

 values.conteineres=find(docPages,[/CONTEINER:\s*([^\n]+)/i,/((?:\b[A-Z]{4}\s*\d{7}\b[^\n]{0,100}){1,5})/i],[4,1]);
 if(values.conteineres.value)values.conteineres.value=normalizeContainers(values.conteineres.value);

 // Peso: se houver NF, prioriza o peso líquido total da página 1 da NF; senão usa o DOC COMPLETO.
 values.peso_liquido=nf1?find([nf1],[/PESO\s+L[IÍ]QUIDO\s*[:\-]?\s*([0-9.,]+)/i],[1]):find(docPages,[/Peso L[ií]quido \(kg\):\s*\n?\s*([0-9.,]+)/i,/NET WEIGHT(?:\s*\(KG\))?\s*[:\-]?\s*([0-9.,]+)/i],[5,4]);
 if(values.peso_liquido.value&&!/kg$/i.test(values.peso_liquido.value))values.peso_liquido.value+=' kg';

 // VALOR TOTAL DA NOTA: exclusivamente página 1 da NF.
 values.valor_total_nota=totalFromNf(nf1);

 const fields:Field[]=keys.map(key=>({key,label:labels[key],...values[key]}));
 return{
  process_type:processType,
  fields,
  pages:results.reduce((a,r)=>a+r.total,0),
  filename:results.map(r=>r.name).join(' + '),
  ocr_pages:all.filter(p=>p.ocr).map(p=>`${p.document} p.${p.page}`),
  documents:results.map(r=>r.kind)
 };
}

export default function App(){
 const docRef=useRef<HTMLInputElement>(null),nfRef=useRef<HTMLInputElement>(null);
 const[docFile,setDocFile]=useState<File|null>(null),[nfFile,setNfFile]=useState<File|null>(null),[analysis,setAnalysis]=useState<Analysis|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const valid=(f:File)=>{
  if(f.type!=='application/pdf'&&!f.name.toLowerCase().endsWith('.pdf')){setError('Somente arquivos PDF são aceitos.');return false}
  if(f.size>25*1024*1024){setError('Cada PDF deve ter no máximo 25 MB.');return false}
  return true;
 };
 const analyze=async()=>{
  if(!docFile&&!nfFile)return;
  setBusy(true);setError('');
  try{
   const rs:ReadResult[]=[];
   if(docFile)rs.push(await readPdf(docFile,'DOC COMPLETO'));
   if(nfFile)rs.push(await readPdf(nfFile,'NF FISCAL'));
   setAnalysis(analyzeDocuments(rs));
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível analisar os PDFs.')}
  finally{setBusy(false)}
 };
 const update=(key:string,value:string)=>setAnalysis(a=>a?({...a,fields:a.fields.map(f=>f.key===key?{...f,value,edited:true,confidence:'high'}:f)}):a);
 const report=useMemo(()=>analysis?analysis.fields.map(f=>`${f.label}: ${f.value??'Não localizado'}`).join('\n'):'',[analysis]);
 const found=analysis?.fields.filter(f=>f.value).length??0;
 const picker=(title:string,file:File|null,setter:(f:File|null)=>void,ref:React.RefObject<HTMLInputElement>,icon:any)=><div className="upload" onClick={()=>ref.current?.click()}><input ref={ref} type="file" accept="application/pdf,.pdf" hidden onChange={e=>{const f=e.target.files?.[0];if(f&&valid(f)){setter(f);setAnalysis(null)}}}/><div className="upload-icon">{icon}</div><h2>{file?file.name:title}</h2><p>{file?'PDF pronto para cruzamento':'clique para selecionar'}</p>{file&&<button className="icon-btn" onClick={e=>{e.stopPropagation();setter(null)}}><X/></button>}</div>;
 return <div className="app"><div className="grid-bg"/><header><div className="brand"><div className="brand-mark"><Sparkles size={19}/></div><div><strong>Conclusão de Processos</strong><span>Extração e conferência cruzada</span></div></div><div className="header-status"><span className="live-dot"/> Sistema operacional</div></header><main>{!analysis?<section className="hero"><div className="eyebrow"><Zap size={15}/> Precisão por posição do documento</div><h1>DOC COMPLETO + NF.<br/><em>Dados conferidos entre si.</em></h1><p className="lead">O sistema lê todas as páginas. Cliente e CNPJ são comparados entre o bloco “For delivery of goods please apply to” do DOC COMPLETO e a área Transportador da NF. O Valor Total da Nota é lido exclusivamente na página 1 da NF.</p><div className="dual-upload">{picker('DOC COMPLETO',docFile,setDocFile,docRef,<FileText/>)}{picker('NF Fiscal (opcional)',nfFile,setNfFile,nfRef,<FilePlus2/>)}</div>{error&&<div className="error"><AlertTriangle size={18}/>{error}</div>}{(docFile||nfFile)&&<button className="primary" onClick={analyze} disabled={busy}>{busy?<><Loader2 className="spin"/> Lendo e cruzando PDFs...</>:<>Analisar Processo <ChevronRight/></>}</button>}</section>:<section className="results"><div className="result-head"><div><div className="eyebrow"><Check size={15}/> Análise concluída</div><h1>Informações necessárias</h1><p>{analysis.documents.join(' + ')} · {found}/{analysis.fields.length} campos localizados</p></div><button className="secondary" onClick={()=>setAnalysis(null)}><RotateCcw size={16}/> Nova análise</button></div><div className="metrics"><div className="metric"><span>Operação</span><b className="type">{analysis.process_type}</b></div><div className="metric"><span>Campos encontrados</span><b>{found}<small>/{analysis.fields.length}</small></b></div><div className="metric"><span>Escopo</span><b>Todas as páginas</b></div></div><div className="table"><div className="table-head"><span>Campo</span><span>Valor extraído</span><span>Confiança</span><span>Fonte / Conferência</span><span/></div>{analysis.fields.map(f=><div className="row" key={f.key}><div><b>{f.label}</b>{f.edited&&<small className="edited">Editado manualmente</small>}</div><div>{f.value===null?<span className="not-found">Não localizado no documento</span>:<input value={f.value} onChange={e=>update(f.key,e.target.value)}/>}</div><div><span className={`confidence ${f.confidence}`}>{f.confidence==='high'?'✓':f.confidence==='medium'?'⚠':'?'} {f.confidence==='high'?'Alta confiança':f.confidence==='medium'?'Revisar':'Baixa confiança'}</span></div><div className="source">{f.source}</div><button className="copy" onClick={()=>void navigator.clipboard?.writeText(f.value??'')}><Clipboard size={15}/></button></div>)}</div><div className="integrity"><div className="shield">✓</div><div><b>Cruzamento DOC COMPLETO + NF</b><span>Cliente e CNPJ são comparados entre os dois PDFs. Se houver divergência, o campo fica marcado para revisão em vez de assumir um valor silenciosamente.</span></div><button className="secondary" onClick={()=>void navigator.clipboard?.writeText(report)}><Clipboard size={16}/> Copiar relatório</button></div></section>}</main><footer><span>CONCLUSÃO DE PROCESSOS · foco em precisão</span><span>DOC COMPLETO + NF Fiscal</span></footer></div>;
}