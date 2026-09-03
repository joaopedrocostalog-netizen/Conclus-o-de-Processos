import { useMemo, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { createWorker } from 'tesseract.js';
import { AlertTriangle, Check, ChevronRight, Clipboard, FileText, Loader2, RotateCcw, Sparkles, Upload, X, Zap } from 'lucide-react';
import './styles.css';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

type Confidence = 'high' | 'medium' | 'low';
type Field = { key:string; label:string; value:string|null; confidence:Confidence; page:number|null; source:string; edited?:boolean };
type PdfPage = { page:number; text:string; ocr:boolean };
type Analysis = { process_type:'IMPORTAÇÃO'|'EXPORTAÇÃO'|'NÃO IDENTIFICADO'; fields:Field[]; pages:number; filename:string; ocr_pages:number[] };

const labels: Record<string,string> = {
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
const keys = Object.keys(labels);
const clean = (s:string) => s.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const oneLine = (s:string) => clean(s).replace(/\n/g,' ').trim();

function textItemsToLines(items:any[]):string {
  let lastY:number|null=null;
  let current='';
  const lines:string[]=[];
  for (const raw of items) {
    if (!('str' in raw)) continue;
    const item=raw as TextItem;
    const str=item.str?.trim();
    if (!str) continue;
    const y=Array.isArray((item as any).transform)?Number((item as any).transform[5]):null;
    if (lastY!==null && y!==null && Math.abs(y-lastY)>2.4) {
      if (current.trim()) lines.push(current.trim());
      current=str;
    } else current += (current?' ':'') + str;
    if (y!==null) lastY=y;
  }
  if (current.trim()) lines.push(current.trim());
  return clean(lines.join('\n'));
}

async function ocrPage(page:any):Promise<string> {
  const viewport=page.getViewport({scale:2.5});
  const canvas=document.createElement('canvas');
  canvas.width=Math.ceil(viewport.width);
  canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext('2d');
  if (!ctx) return '';
  await page.render({canvasContext:ctx,viewport}).promise;
  const worker=await createWorker('eng');
  try {
    await worker.setParameters({ preserve_interword_spaces:'1' });
    const result=await worker.recognize(canvas);
    return clean(result.data.text||'');
  } finally { await worker.terminate(); }
}

async function readRelevantPages(file:File):Promise<{pages:PdfPage[];total:number}> {
  const pdf=await getDocument({data:await file.arrayBuffer()}).promise;
  const max=Math.min(5,pdf.numPages);
  const pages:PdfPage[]=[];
  for (let i=1;i<=max;i++) {
    const page=await pdf.getPage(i);
    const content=await page.getTextContent();
    let text=textItemsToLines(content.items as any[]);
    let ocr=false;
    if (i===1) {
      try {
        const ocrText=await ocrPage(page);
        if (ocrText.length>30) {
          text=clean(`${text}\n${ocrText}`);
          ocr=true;
        }
      } catch { /* mantém texto extraído */ }
    }
    pages.push({page:i,text,ocr});
  }
  return {pages,total:pdf.numPages};
}

function orderedPages(pages:PdfPage[], preferred:number[]):PdfPage[] {
  const byPage=new Map(pages.map(p=>[p.page,p]));
  const out:PdfPage[]=[];
  for (const n of preferred) {
    const p=byPage.get(n);
    if (p) out.push(p);
  }
  for (const p of pages) if (!out.some(x=>x.page===p.page)) out.push(p);
  return out;
}

function find(pages:PdfPage[], patterns:RegExp[], confidence:Confidence='high', preferred:number[]=[4,5,1,2,3]) {
  for (const p of orderedPages(pages,preferred)) {
    for (const re of patterns) {
      const m=p.text.match(re);
      if (m?.[1]) {
        const value=oneLine(m[1]);
        if (value) return {value,page:p.page,source:`Página ${p.page}: ${value}`,confidence};
      }
    }
  }
  return {value:null as string|null,page:null as number|null,source:'Não localizado nas páginas 1 a 5',confidence:'low' as Confidence};
}

function normalizeCompany(v:string|null):string|null {
  if (!v) return null;
  return oneLine(v)
    .replace(/^OPE_\d+\s*-\s*/i,'')
    .replace(/\s{2,}/g,' ')
    .replace(/\s+(CNPJ|TAX ID|ADDRESS|ENDERE[CÇ]O).*$/i,'')
    .trim();
}

function normalizeContainers(v:string|null):string|null {
  if (!v) return null;
  const matches=[...v.matchAll(/\b[A-Z]{4}\d{7}\b/g)].map(m=>m[0]);
  const unique=[...new Set(matches)];
  return unique.length?unique.join(' / '):oneLine(v);
}

function normalizeBL(v:string|null):string|null {
  if (!v) return null;
  return v.replace(/[^A-Z0-9]/gi,'').toUpperCase();
}

function analyzePages(pages:PdfPage[], total:number, filename:string):Analysis {
  const full=pages.map(p=>p.text).join('\n');
  const values:Record<string,ReturnType<typeof find>>={};
  const set=(key:string, patterns:RegExp[], confidence:Confidence='high', preferred?:number[])=>{ values[key]=find(pages,patterns,confidence,preferred); };
  const fixed=(key:string,value:string|null,page:number|null,source:string,confidence:Confidence='high')=>{
    values[key]={value,page,source,confidence:value?confidence:'low'};
  };

  const processType:'IMPORTAÇÃO'|'EXPORTAÇÃO'|'NÃO IDENTIFICADO' = /\bDUIMP\b|Nome do importador|Importa[cç][aã]o/i.test(full)
    ? 'IMPORTAÇÃO'
    : (/\bDUE\b|Nome do exportador|Exporta[cç][aã]o/i.test(full)?'EXPORTAÇÃO':'NÃO IDENTIFICADO');

  set('cliente',[
    /Nome do importador:\s*\n?\s*([^\n]+)/i,
    /Consignee(?:\s*\/\s*Importer)?[^\n]*\n\s*([^\n]+)/i,
    /CONSIGNEE[^\n]*\n\s*([^\n]+)/i
  ],'high',[4,5,1,2,3]);
  if (values.cliente?.value) values.cliente.value=normalizeCompany(values.cliente.value);

  fixed('tipo_documento',
    /Extrato da Duimp|\bDUIMP\b/i.test(full)?'DUIMP':(/\bDUE\b/i.test(full)?'DUE':(/BILL OF LADING|B\/L(?:\s*No)?/i.test(full)?'BL':null)),
    /Extrato da Duimp|\bDUIMP\b/i.test(full)?4:1,
    'Tipo identificado diretamente no documento'
  );

  set('remetente',[
    /(?:CONSIGNOR\s*\/\s*SHIPPER|SHIPPER(?:'S)?(?: NAME AND ADDRESS)?)[^\n]*\n\s*([^\n]{3,100})/i,
    /(?:SHIPPER|EXPORTER)\s*[:\-]?\s*([^\n]{3,100})/i,
    /C[oó]digo do Exportador Estrangeiro:\s*\n?\s*(?:OPE_\d+\s*-\s*)?([^\n]+)/i
  ],'high',[1,4,5,2,3]);
  if (values.remetente?.value) values.remetente.value=normalizeCompany(values.remetente.value);

  set('agencia_maritima',[
    /\b([A-Z][A-Z .,&'-]{2,80}\s+(?:CO\.?\s*,?\s*LTD\.?|LOGISTICS?\s+CO\.?\s*,?\s*LTD\.?|SHIPPING\s+LINE|LINES))\b/i,
    /(?:CARRIER|OCEAN CARRIER)\s*[:\-]?\s*([^\n]{3,100})/i
  ],'high',[1,4,5,2,3]);

  set('numero_bl_awb',[
    /Conhecimento\.{0,10}:\s*([A-Z0-9-]{8,})/i,
    /B\/?L(?:\s*(?:No|Nº|NUMBER))?\s*[:#-]?\s*([A-Z0-9-]{8,})/i,
    /BILL OF LADING\s*(?:NO\.?|NUMBER)?\s*[:#-]?\s*([A-Z0-9-]{8,})/i
  ],'high',[4,1,5,2,3]);
  if (values.numero_bl_awb?.value) values.numero_bl_awb.value=normalizeBL(values.numero_bl_awb.value);

  set('local_armazenagem',[
    /Recinto Alfandeg[aá]rio\.{0,10}:\s*([^\n]+)/i,
    /Setor Alfandeg[aá]rio\.{0,10}:\s*([^\n]+)/i,
    /(?:PLACE OF STORAGE|WAREHOUSE|TERMINAL)\s*[:\-]?\s*([^\n]+)/i
  ],'high',[4,5,1,2,3]);

  set('ref_cliente',[
    /REF\.?\s*IMPORTADOR\.{0,10}:\s*([A-Z0-9./-]+)/i,
    /REF\.?\s*EXPORTADOR\.{0,10}:\s*([A-Z0-9./-]+)/i,
    /Nossa Refer[eê]ncia\.{0,10}:\s*([A-Z0-9./-]+)/i
  ],'high',[4,5,1,2,3]);

  set('numero_documento',[
    /Extrato da Duimp\s+([0-9A-Z-]{10,25})/i,
    /\bDUIMP\s*[:.]?\s*([0-9A-Z-]{10,25})/i,
    /\bDUE\s*[:.]?\s*([0-9A-Z-]{10,25})/i
  ],'high',[4,5,2,3,1]);

  if (values.cliente?.value) {
    values.destinatario={...values.cliente,source:`Importador identificado: ${values.cliente.value}`,confidence:'high'};
  } else {
    set('destinatario',[
      /Consignee(?:\s*\/\s*Importer)?[^\n]*\n\s*([^\n]+)/i,
      /Nome do importador:\s*\n?\s*([^\n]+)/i
    ],'high',[1,4,5,2,3]);
  }

  set('porto_origem',[
    /Port of Loading\s*[:\-]?\s*\n?\s*([^\n]+)/i,
    /PORT OF LOADING[^\n]*\n\s*([^\n]+)/i,
    /Porto de Origem\s*[:\-]?\s*([^\n]+)/i
  ],'high',[1,4,5,2,3]);

  fixed('operacao_maritima',
    processType==='IMPORTAÇÃO'?'Importação':(processType==='EXPORTAÇÃO'?'Exportação':null),
    values.numero_documento?.page||4,
    processType==='NÃO IDENTIFICADO'?'Não foi possível identificar a operação':'Operação definida pelo documento aduaneiro'
  );

  set('cnpj_cliente',[
    /CNPJ do importador:\s*\n?\s*([0-9./-]+)/i,
    /CNPJ(?:\s+do\s+(?:cliente|importador))?\s*[:.]?\s*([0-9]{2}\.[0-9]{3}\.[0-9]{3}\/[0-9]{4}-[0-9]{2})/i
  ],'high',[4,5,2,3,1]);

  set('conteineres',[
    /CONTEINER:\s*([^\n]+)/i,
    /CONTAINER(?:S| NO\.?| NUMBER)?\s*[:\-]?\s*([^\n]{10,180})/i,
    /((?:\b[A-Z]{4}\d{7}\b(?:[^\n]{0,80})){1,4})/i
  ],'high',[4,1,5,2,3]);
  if (values.conteineres?.value) values.conteineres.value=normalizeContainers(values.conteineres.value);

  set('peso_liquido',[
    /Peso L[ií]quido \(kg\):\s*\n?\s*([0-9.,]+)/i,
    /NET WEIGHT(?:\s*\(KG\))?\s*[:\-]?\s*([0-9.,]+)/i
  ],'high',[5,4,1,2,3]);
  if (values.peso_liquido?.value && !/kg$/i.test(values.peso_liquido.value)) values.peso_liquido.value=`${values.peso_liquido.value} kg`;

  const fields:Field[]=keys.map(key=>({key,label:labels[key],...values[key]}));
  return {process_type:processType,fields,pages:total,filename,ocr_pages:pages.filter(p=>p.ocr).map(p=>p.page)};
}

async function analyzePdf(file:File):Promise<Analysis> {
  const {pages,total}=await readRelevantPages(file);
  return analyzePages(pages,total,file.name);
}

export default function App(){
  const inputRef=useRef<HTMLInputElement>(null);
  const [file,setFile]=useState<File|null>(null);
  const [analysis,setAnalysis]=useState<Analysis|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  const selectFile=(f?:File)=>{
    setError('');
    if(!f)return;
    if(f.type!=='application/pdf'&&!f.name.toLowerCase().endsWith('.pdf'))return setError('Somente arquivos PDF são aceitos.');
    if(f.size>25*1024*1024)return setError('O arquivo excede o limite de 25 MB.');
    setFile(f);setAnalysis(null);
  };

  const analyze=async()=>{
    if(!file)return;
    setBusy(true);setError('');
    try{setAnalysis(await analyzePdf(file));}
    catch(e){setError(e instanceof Error?e.message:'Não foi possível analisar o PDF.');}
    finally{setBusy(false);}
  };

  const update=(key:string,value:string)=>setAnalysis(a=>a?({...a,fields:a.fields.map(f=>f.key===key?{...f,value,edited:true,confidence:'high'}:f)}):a);
  const report=useMemo(()=>analysis?analysis.fields.map(f=>`${f.label}: ${f.value??'Não localizado'}`).join('\n'):'',[analysis]);
  const found=analysis?.fields.filter(f=>f.value).length??0;

  return <div className="app"><div className="grid-bg"/>
    <header><div className="brand"><div className="brand-mark"><Sparkles size={19}/></div><div><strong>Conclusão de Processos</strong><span>Extração objetiva para logística</span></div></div><div className="header-status"><span className="live-dot"/> Sistema operacional</div></header>
    <main>{!analysis?<section className="hero">
      <div className="eyebrow"><Zap size={15}/> Precisão focada nos 14 campos necessários</div>
      <h1>Leia o processo.<br/><em>Preencha só o que importa.</em></h1>
      <p className="lead">O sistema analisa somente as páginas 1 a 5 do DOC COMPLETO, usa OCR na página 1 e retorna exclusivamente os 14 campos definidos para o cadastro.</p>
      <div className="upload" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();selectFile(e.dataTransfer.files[0])}} onClick={()=>inputRef.current?.click()}>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={e=>selectFile(e.target.files?.[0])}/>
        <div className="upload-icon"><Upload/></div><h2>{file?'PDF selecionado':'Arraste seu PDF aqui'}</h2><p>{file?file.name:'ou clique para selecionar'}</p><small>PDF · máximo 25 MB</small>
      </div>
      {file&&<div className="filebar"><div><FileText size={18}/><div><b>{file.name}</b><span>{(file.size/1024/1024).toFixed(2)} MB</span></div></div><button className="icon-btn" onClick={()=>setFile(null)}><X/></button></div>}
      {error&&<div className="error"><AlertTriangle size={18}/>{error}</div>}
      {file&&<button className="primary" onClick={analyze} disabled={busy}>{busy?<><Loader2 className="spin"/> Lendo páginas 1 a 5...</>:<>Analisar Processo <ChevronRight/></>}</button>}
    </section>:<section className="results">
      <div className="result-head"><div><div className="eyebrow"><Check size={15}/> Análise concluída</div><h1>Informações necessárias</h1><p>{analysis.filename} · {found}/{analysis.fields.length} campos localizados{analysis.ocr_pages.length?` · OCR: página ${analysis.ocr_pages.join(', ')}`:''}</p></div><button className="secondary" onClick={()=>{setAnalysis(null);setFile(null)}}><RotateCcw size={16}/> Nova análise</button></div>
      <div className="metrics"><div className="metric"><span>Operação</span><b className="type">{analysis.process_type}</b></div><div className="metric"><span>Campos encontrados</span><b>{found}<small>/{analysis.fields.length}</small></b></div><div className="metric"><span>Escopo de leitura</span><b>1–5</b></div></div>
      <div className="table"><div className="table-head"><span>Campo</span><span>Valor extraído</span><span>Confiança</span><span>Fonte</span><span/></div>{analysis.fields.map(f=><div className="row" key={f.key}><div><b>{f.label}</b>{f.edited&&<small className="edited">Editado manualmente</small>}</div><div>{f.value===null?<span className="not-found">Não localizado no documento</span>:<input value={f.value} onChange={e=>update(f.key,e.target.value)}/>}</div><div><span className={`confidence ${f.confidence}`}>{f.confidence==='high'?'✓':f.confidence==='medium'?'⚠':'?'} {f.confidence==='high'?'Alta confiança':f.confidence==='medium'?'Média confiança':'Baixa confiança'}</span></div><div className="source">{f.source}</div><button className="copy" title="Copiar" onClick={()=>void navigator.clipboard?.writeText(f.value??'')}><Clipboard size={15}/></button></div>)}</div>
      <div className="integrity"><div className="shield">✓</div><div><b>Somente os campos necessários</b><span>Nenhum campo extra é exibido. Quando não houver evidência suficiente, o sistema retorna “Não localizado” em vez de adivinhar.</span></div><button className="secondary" onClick={()=>void navigator.clipboard?.writeText(report)}><Clipboard size={16}/> Copiar relatório</button></div>
    </section>}</main>
    <footer><span>CONCLUSÃO DE PROCESSOS · foco em precisão</span><span>Leitura dirigida das páginas 1 a 5</span></footer>
  </div>;
}
