import { useMemo, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { createWorker } from 'tesseract.js';
import { AlertTriangle, Check, ChevronRight, Clipboard, FilePlus2, FileText, Loader2, RotateCcw, Sparkles, Upload, X, Zap } from 'lucide-react';
import './styles.css';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

type Confidence = 'high' | 'medium' | 'low';
type Field = { key:string; label:string; value:string|null; confidence:Confidence; page:number|null; source:string; edited?:boolean };
type PdfPage = { page:number; text:string; ocr:boolean; document:string };
type Analysis = { process_type:'IMPORTAÇÃO'|'EXPORTAÇÃO'|'NÃO IDENTIFICADO'; fields:Field[]; pages:number; filename:string; ocr_pages:string[]; documents:string[] };

type ReadResult = { pages:PdfPage[]; total:number; name:string; kind:'DOC COMPLETO'|'NF FISCAL' };

const labels:Record<string,string> = {
  cliente:'Cliente',
  tipo_documento:'Tipo Documento',
  remetente:'Remetente / Exportador',
  agencia_maritima:'Agência Marítima / Carrier',
  numero_bl_awb:'Nº BL / AWB',
  local_armazenagem:'Local de Armazenagem',
  ref_cliente:'Ref. do Cliente',
  numero_documento:'Nº Documento',
  destinatario:'Destinatário / Importador',
  porto_origem:'Porto de Origem',
  operacao_maritima:'Operação Marítima',
  cnpj_cliente:'CNPJ do Cliente / Importador',
  conteineres:'Contêineres',
  peso_liquido:'Peso Líquido'
};
const keys=Object.keys(labels);
const clean=(s:string)=>s.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const oneLine=(s:string)=>clean(s).replace(/\n/g,' ').trim();

function textItemsToLines(items:any[]):string {
  let lastY:number|null=null,current='';
  const lines:string[]=[];
  for(const raw of items){
    if(!('str' in raw)) continue;
    const item=raw as TextItem;
    const str=item.str?.trim();
    if(!str) continue;
    const y=Array.isArray((item as any).transform)?Number((item as any).transform[5]):null;
    if(lastY!==null&&y!==null&&Math.abs(y-lastY)>2.4){ if(current.trim()) lines.push(current.trim()); current=str; }
    else current+=(current?' ':'')+str;
    if(y!==null) lastY=y;
  }
  if(current.trim()) lines.push(current.trim());
  return clean(lines.join('\n'));
}

async function ocrPage(page:any,lang='eng+por'):Promise<string>{
  const viewport=page.getViewport({scale:2.5});
  const canvas=document.createElement('canvas');
  canvas.width=Math.ceil(viewport.width); canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext('2d'); if(!ctx) return '';
  await page.render({canvasContext:ctx,viewport}).promise;
  const worker=await createWorker(lang);
  try{
    await worker.setParameters({preserve_interword_spaces:'1'});
    const result=await worker.recognize(canvas);
    return clean(result.data.text||'');
  }finally{ await worker.terminate(); }
}

async function readPdf(file:File,kind:ReadResult['kind']):Promise<ReadResult>{
  const pdf=await getDocument({data:await file.arrayBuffer()}).promise;
  const pages:PdfPage[]=[];
  for(let i=1;i<=pdf.numPages;i++){
    const page=await pdf.getPage(i);
    const content=await page.getTextContent();
    let text=textItemsToLines(content.items as any[]);
    let ocr=false;
    const sparse=text.replace(/\s/g,'').length<35;
    const mustOcr=i===1; // BLs de DOC COMPLETO costumam ter a página 1 digitalizada.
    if(mustOcr||sparse){
      try{
        const ocrText=await ocrPage(page);
        if(ocrText.length>20){ text=clean(`${text}\n${ocrText}`); ocr=true; }
      }catch{ /* mantém a camada textual quando OCR falhar */ }
    }
    pages.push({page:i,text,ocr,document:kind});
  }
  return {pages,total:pdf.numPages,name:file.name,kind};
}

function orderedPages(pages:PdfPage[],preferred:number[]=[]):PdfPage[]{
  if(!preferred.length) return pages;
  const out:PdfPage[]=[];
  for(const n of preferred){ for(const p of pages) if(p.page===n&&!out.includes(p)) out.push(p); }
  for(const p of pages) if(!out.includes(p)) out.push(p);
  return out;
}

function find(pages:PdfPage[],patterns:RegExp[],confidence:Confidence='high',preferred:number[]=[]){
  for(const p of orderedPages(pages,preferred)){
    for(const re of patterns){
      const m=p.text.match(re);
      if(m?.[1]){
        const value=oneLine(m[1]);
        if(value) return {value,page:p.page,source:`${p.document} · página ${p.page}: ${value}`,confidence};
      }
    }
  }
  return {value:null as string|null,page:null as number|null,source:'Não localizado nos PDFs analisados',confidence:'low' as Confidence};
}

function lines(text:string){ return text.split(/\n+/).map(oneLine).filter(Boolean); }

function valueAfterLabel(page:PdfPage,label:RegExp,invalid:RegExp[]=[]):ReturnType<typeof find>{
  const ls=lines(page.text);
  for(let i=0;i<ls.length;i++){
    if(!label.test(ls[i])) continue;
    const same=ls[i].replace(label,'').replace(/^\s*[:\-]\s*/,'').trim();
    if(same&&same.length>2&&!invalid.some(r=>r.test(same))) return {value:same,page:page.page,source:`${page.document} · página ${page.page}: ${same}`,confidence:'high'};
    for(let j=i+1;j<Math.min(i+6,ls.length);j++){
      const candidate=ls[j].trim();
      if(candidate.length<2||invalid.some(r=>r.test(candidate))) continue;
      return {value:candidate,page:page.page,source:`${page.document} · página ${page.page}: ${candidate}`,confidence:'high'};
    }
  }
  return {value:null,page:null,source:'Não localizado nos PDFs analisados',confidence:'low'};
}

function normalizeCompany(v:string|null):string|null{
  if(!v) return null;
  return oneLine(v).replace(/^OPE_\d+\s*-\s*/i,'').replace(/\s+(CNPJ|TAX ID|ADDRESS|ENDERE[CÇ]O).*$/i,'').trim();
}
function normalizeContainers(v:string|null):string|null{
  if(!v) return null;
  const found=[...v.matchAll(/\b[A-Z]{4}\s*\d{7}\b/gi)].map(m=>m[0].replace(/\s/g,'').toUpperCase());
  return found.length?[...new Set(found)].join(' / '):oneLine(v);
}
function normalizeBL(v:string|null):string|null{ return v?v.replace(/[^A-Z0-9]/gi,'').toUpperCase():null; }
function normalizePort(v:string|null):string|null{
  if(!v) return null;
  return oneLine(v).replace(/\bPort of Discharge\b.*$/i,'').replace(/\bPlace of Delivery\b.*$/i,'').trim();
}

function analyzeDocuments(results:ReadResult[]):Analysis{
  const all=results.flatMap(r=>r.pages);
  const docPages=results.find(r=>r.kind==='DOC COMPLETO')?.pages||[];
  const nfPages=results.find(r=>r.kind==='NF FISCAL')?.pages||[];
  const full=all.map(p=>p.text).join('\n');
  const values:Record<string,ReturnType<typeof find>>={};
  const set=(key:string,pages:PdfPage[],patterns:RegExp[],confidence:Confidence='high',preferred:number[]=[])=>{ values[key]=find(pages,patterns,confidence,preferred); };
  const fixed=(key:string,value:string|null,page:number|null,source:string,confidence:Confidence='high')=>{ values[key]={value,page,source,confidence:value?confidence:'low'}; };

  const processType:'IMPORTAÇÃO'|'EXPORTAÇÃO'|'NÃO IDENTIFICADO'=/\bDUIMP\b|Nome do importador|Importa[cç][aã]o/i.test(full)?'IMPORTAÇÃO':(/\bDUE\b|Nome do exportador|Exporta[cç][aã]o/i.test(full)?'EXPORTAÇÃO':'NÃO IDENTIFICADO');

  set('cliente',docPages.length?docPages:all,[/Nome do importador:\s*\n?\s*([^\n]+)/i,/Consignee(?:\s*\/\s*Importer)?[^\n]*\n\s*([^\n]+)/i],'high',[4,1]);
  if(!values.cliente?.value&&nfPages.length) set('cliente',nfPages,[/(?:DESTINAT[ÁA]RIO\s*\/\s*REMETENTE|NOME\s*\/\s*RAZ[AÃ]O SOCIAL)\s*\n?\s*([^\n]+)/i]);
  if(values.cliente?.value) values.cliente.value=normalizeCompany(values.cliente.value);

  const hasDuimp=/Extrato da Duimp|\bDUIMP\b/i.test(full),hasDue=/\bDUE\b/i.test(full),hasNfe=/\bDANFE\b|NF-?e|NOTA FISCAL ELETR[ÔO]NICA/i.test(full);
  fixed('tipo_documento',[hasDuimp?'DUIMP':null,hasDue?'DUE':null,hasNfe?'NF-e':null].filter(Boolean).join(' + ')||(/BILL OF LADING|B\/L/i.test(full)?'BL':null),hasDuimp?4:1,'Tipo(s) identificado(s) diretamente nos documentos');

  // Regra prioritária: Remetente/Exportador vem do campo Consignor/Shipper da página 1 do DOC COMPLETO.
  const page1=docPages.find(p=>p.page===1);
  if(page1) values.remetente=valueAfterLabel(page1,/\b(?:Consignor\s*\/\s*Shipper|Consignor|Shipper)\b/i,[/Port of Loading|Consignee|Notify|B\/L|Bill of Lading/i]);
  if(!values.remetente?.value) set('remetente',docPages.length?docPages:all,[/C[oó]digo do Exportador Estrangeiro:\s*\n?\s*(?:OPE_\d+\s*-\s*)?([^\n]+)/i,/Exporter\s*[:\-]?\s*([^\n]+)/i],'medium',[1,4]);
  if(values.remetente?.value) values.remetente.value=normalizeCompany(values.remetente.value);

  if(page1){
    const carrier=valueAfterLabel(page1,/\b(?:Carrier|Ocean Carrier)\b/i,[/Freight|Place of|B\/L|Port of/i]);
    values.agencia_maritima=carrier.value?carrier:find([page1],[/\b([A-Z][A-Z .,&'-]{2,80}\s+(?:CO\.?\s*,?\s*LTD\.?|SHIPPING\s+LINE|LINES))\b/i],'medium',[1]);
  }else set('agencia_maritima',all,[/(?:CARRIER|OCEAN CARRIER)\s*[:\-]?\s*([^\n]{3,100})/i]);

  set('numero_bl_awb',docPages.length?docPages:all,[/Conhecimento\.{0,10}:\s*([A-Z0-9-]{8,})/i,/B\/?L(?:\s*(?:No|Nº|NUMBER))?\s*[:#-]?\s*([A-Z0-9-]{8,})/i,/BILL OF LADING\s*(?:NO\.?|NUMBER)?\s*[:#-]?\s*([A-Z0-9-]{8,})/i],'high',[4,1]);
  if(values.numero_bl_awb?.value) values.numero_bl_awb.value=normalizeBL(values.numero_bl_awb.value);

  set('local_armazenagem',docPages.length?docPages:all,[/Recinto Alfandeg[aá]rio\.{0,10}:\s*([^\n]+)/i,/Setor Alfandeg[aá]rio\.{0,10}:\s*([^\n]+)/i,/(?:PLACE OF STORAGE|WAREHOUSE|TERMINAL)\s*[:\-]?\s*([^\n]+)/i],'high',[4,5]);
  set('ref_cliente',docPages.length?docPages:all,[/REF\.?\s*IMPORTADOR\.{0,10}:\s*([A-Z0-9./-]+)/i,/REF\.?\s*EXPORTADOR\.{0,10}:\s*([A-Z0-9./-]+)/i,/Nossa Refer[eê]ncia\.{0,10}:\s*([A-Z0-9./-]+)/i],'high',[4,2]);
  set('numero_documento',docPages.length?docPages:all,[/Extrato da Duimp\s+([0-9A-Z-]{10,25})/i,/\bDUIMP\s*[:.]?\s*([0-9A-Z-]{10,25})/i,/\bDUE\s*[:.]?\s*([0-9A-Z-]{10,25})/i],'high',[4]);

  if(values.cliente?.value) values.destinatario={...values.cliente,source:`Importador identificado: ${values.cliente.value}`,confidence:'high'};
  else set('destinatario',all,[/Nome do importador:\s*\n?\s*([^\n]+)/i,/Consignee[^\n]*\n\s*([^\n]+)/i]);

  // Regra prioritária: Porto de Origem vem do campo Port of Loading da página 1 do DOC COMPLETO.
  if(page1) values.porto_origem=valueAfterLabel(page1,/\bPort\s+of\s+Loading\b/i,[/Port of Discharge|Place of Delivery|Vessel|Voyage/i]);
  if(!values.porto_origem?.value) set('porto_origem',docPages.length?docPages:all,[/Port of Loading\s*[:\-]?\s*\n?\s*([^\n]+)/i,/Porto de Origem\s*[:\-]?\s*([^\n]+)/i],'medium',[1]);
  if(values.porto_origem?.value) values.porto_origem.value=normalizePort(values.porto_origem.value);

  fixed('operacao_maritima',processType==='IMPORTAÇÃO'?'Importação':processType==='EXPORTAÇÃO'?'Exportação':null,values.numero_documento?.page||null,processType==='NÃO IDENTIFICADO'?'Não foi possível identificar a operação':'Operação definida pelo documento aduaneiro');

  set('cnpj_cliente',docPages.length?docPages:all,[/CNPJ do importador:\s*\n?\s*([0-9./-]+)/i,/CNPJ(?:\s+do\s+(?:cliente|importador))?\s*[:.]?\s*([0-9]{2}\.[0-9]{3}\.[0-9]{3}\/[0-9]{4}-[0-9]{2})/i],'high',[4]);
  if(!values.cnpj_cliente?.value&&nfPages.length) set('cnpj_cliente',nfPages,[/CNPJ\s*[:.]?\s*([0-9]{2}\.[0-9]{3}\.[0-9]{3}\/[0-9]{4}-[0-9]{2})/i]);

  set('conteineres',docPages.length?docPages:all,[/CONTEINER:\s*([^\n]+)/i,/CONTAINER(?:S| NO\.?| NUMBER)?\s*[:\-]?\s*([^\n]{10,220})/i,/((?:\b[A-Z]{4}\s*\d{7}\b(?:[^\n]{0,80})){1,6})/i],'high',[4,1]);
  if(values.conteineres?.value) values.conteineres.value=normalizeContainers(values.conteineres.value);

  set('peso_liquido',docPages.length?docPages:all,[/Peso L[ií]quido \(kg\):\s*\n?\s*([0-9.,]+)/i,/NET WEIGHT(?:\s*\(KG\))?\s*[:\-]?\s*([0-9.,]+)/i],'high',[5,4]);
  if(!values.peso_liquido?.value&&nfPages.length) set('peso_liquido',nfPages,[/PESO L[IÍ]QUIDO\s*[:\-]?\s*([0-9.,]+)/i]);
  if(values.peso_liquido?.value&&!/kg$/i.test(values.peso_liquido.value)) values.peso_liquido.value=`${values.peso_liquido.value} kg`;

  const fields:Field[]=keys.map(key=>({key,label:labels[key],...(values[key]||find([],[]))}));
  const total=results.reduce((n,r)=>n+r.total,0);
  return {process_type:processType,fields,pages:total,filename:results.map(r=>r.name).join(' + '),ocr_pages:all.filter(p=>p.ocr).map(p=>`${p.document} p.${p.page}`),documents:results.map(r=>r.kind)};
}

async function analyzeFiles(docFile:File|null,nfFile:File|null):Promise<Analysis>{
  const results:ReadResult[]=[];
  if(docFile) results.push(await readPdf(docFile,'DOC COMPLETO'));
  if(nfFile) results.push(await readPdf(nfFile,'NF FISCAL'));
  if(!results.length) throw new Error('Selecione ao menos um PDF.');
  return analyzeDocuments(results);
}

export default function App(){
  const docInput=useRef<HTMLInputElement>(null),nfInput=useRef<HTMLInputElement>(null);
  const [docFile,setDocFile]=useState<File|null>(null),[nfFile,setNfFile]=useState<File|null>(null);
  const [analysis,setAnalysis]=useState<Analysis|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');

  const validate=(f?:File)=>{ if(!f)return null; if(f.type!=='application/pdf'&&!f.name.toLowerCase().endsWith('.pdf')){setError('Somente arquivos PDF são aceitos.');return null;} if(f.size>25*1024*1024){setError('Cada PDF deve ter no máximo 25 MB.');return null;} setError('');return f; };
  const analyze=async()=>{ setBusy(true);setError('');try{setAnalysis(await analyzeFiles(docFile,nfFile));}catch(e){setError(e instanceof Error?e.message:'Não foi possível analisar os PDFs.');}finally{setBusy(false);} };
  const update=(key:string,value:string)=>setAnalysis(a=>a?({...a,fields:a.fields.map(f=>f.key===key?{...f,value,edited:true,confidence:'high'}:f)}):a);
  const report=useMemo(()=>analysis?analysis.fields.map(f=>`${f.label}: ${f.value??'Não localizado'}`).join('\n'):'',[analysis]);
  const found=analysis?.fields.filter(f=>f.value).length??0;

  const slot=(kind:'doc'|'nf',file:File|null)=>{
    const isDoc=kind==='doc',ref=isDoc?docInput:nfInput;
    return <div className="upload" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const f=validate(e.dataTransfer.files[0]);if(isDoc)setDocFile(f);else setNfFile(f);setAnalysis(null);}} onClick={()=>ref.current?.click()}>
      <input ref={ref} type="file" accept="application/pdf,.pdf" hidden onChange={e=>{const f=validate(e.target.files?.[0]);if(isDoc)setDocFile(f);else setNfFile(f);setAnalysis(null);}}/>
      <div className="upload-icon">{isDoc?<Upload/>:<FilePlus2/>}</div>
      <h2>{isDoc?'DOC COMPLETO':'NF Fiscal (opcional)'}</h2>
      <p>{file?file.name:(isDoc?'Selecione o processo completo':'Adicione a NF-e para cruzar informações')}</p>
      <small>{file?`${(file.size/1024/1024).toFixed(2)} MB`:'PDF · máximo 25 MB'}</small>
    </div>;
  };

  return <div className="app"><div className="grid-bg"/>
    <header><div className="brand"><div className="brand-mark"><Sparkles size={19}/></div><div><strong>Conclusão de Processos</strong><span>Extração objetiva para logística</span></div></div><div className="header-status"><span className="live-dot"/> Sistema operacional</div></header>
    <main>{!analysis?<section className="hero">
      <div className="eyebrow"><Zap size={15}/> Precisão focada nos 14 campos necessários</div>
      <h1>Leia o processo inteiro.<br/><em>Cruze os documentos.</em></h1>
      <p className="lead">O sistema lê todas as páginas do DOC COMPLETO. Você também pode adicionar a NF Fiscal para cruzar informações e aumentar a precisão. A página 1 recebe OCR para identificar Consignor/Shipper e Port of Loading.</p>
      {slot('doc',docFile)}
      {docFile&&<div className="filebar"><div><FileText size={18}/><div><b>DOC COMPLETO</b><span>{docFile.name}</span></div></div><button className="icon-btn" onClick={()=>{setDocFile(null);setAnalysis(null)}}><X/></button></div>}
      {slot('nf',nfFile)}
      {nfFile&&<div className="filebar"><div><FileText size={18}/><div><b>NF Fiscal</b><span>{nfFile.name}</span></div></div><button className="icon-btn" onClick={()=>{setNfFile(null);setAnalysis(null)}}><X/></button></div>}
      {error&&<div className="error"><AlertTriangle size={18}/>{error}</div>}
      {(docFile||nfFile)&&<button className="primary" onClick={analyze} disabled={busy}>{busy?<><Loader2 className="spin"/> Lendo todos os documentos...</>:<>Analisar e cruzar informações <ChevronRight/></>}</button>}
    </section>:<section className="results">
      <div className="result-head"><div><div className="eyebrow"><Check size={15}/> Análise concluída</div><h1>Informações necessárias</h1><p>{analysis.documents.join(' + ')} · {analysis.pages} página(s) lidas · {found}/{analysis.fields.length} campos localizados{analysis.ocr_pages.length?` · OCR: ${analysis.ocr_pages.join(', ')}`:''}</p></div><button className="secondary" onClick={()=>setAnalysis(null)}><RotateCcw size={16}/> Nova análise</button></div>
      <div className="metrics"><div className="metric"><span>Operação</span><b className="type">{analysis.process_type}</b></div><div className="metric"><span>Campos encontrados</span><b>{found}<small>/{analysis.fields.length}</small></b></div><div className="metric"><span>Escopo de leitura</span><b>Todas as páginas</b></div></div>
      <div className="table"><div className="table-head"><span>Campo</span><span>Valor extraído</span><span>Confiança</span><span>Fonte</span><span/></div>{analysis.fields.map(f=><div className="row" key={f.key}><div><b>{f.label}</b>{f.edited&&<small className="edited">Editado manualmente</small>}</div><div>{f.value===null?<span className="not-found">Não localizado no documento</span>:<input value={f.value} onChange={e=>update(f.key,e.target.value)}/>}</div><div><span className={`confidence ${f.confidence}`}>{f.confidence==='high'?'✓':f.confidence==='medium'?'⚠':'?'} {f.confidence==='high'?'Alta confiança':f.confidence==='medium'?'Média confiança':'Baixa confiança'}</span></div><div className="source">{f.source}</div><button className="copy" title="Copiar" onClick={()=>void navigator.clipboard?.writeText(f.value??'')}><Clipboard size={15}/></button></div>)}</div>
      <div className="integrity"><div className="shield">✓</div><div><b>Leitura completa com prioridade por campo</b><span>Remetente/Exportador e Porto de Origem são buscados primeiro na página 1 do DOC COMPLETO. A NF Fiscal complementa os dados sem substituir uma informação aduaneira mais específica.</span></div><button className="secondary" onClick={()=>void navigator.clipboard?.writeText(report)}><Clipboard size={16}/> Copiar relatório</button></div>
    </section>}</main>
    <footer><span>CONCLUSÃO DE PROCESSOS · foco em precisão</span><span>DOC COMPLETO + NF Fiscal</span></footer>
  </div>;
}