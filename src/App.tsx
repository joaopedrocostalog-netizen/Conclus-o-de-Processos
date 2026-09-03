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

async function ocrFirstPage(page:any):Promise<string> {
  const viewport=page.getViewport({scale:2.2});
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
    if (i===1 && text.replace(/\s/g,'').length<100) {
      try {
        const ocrText=await ocrFirstPage(page);
        if (ocrText.length>text.length) { text=ocrText; ocr=true; }
      } catch { /* usa o texto disponível */ }
    }
    pages.push({page:i,text,ocr});
  }
  return {pages,total:pdf.numPages};
}

function find(pages:PdfPage[], patterns:RegExp[], confidence:Confidence='high') {
  for (const p of pages) {
    for (const re of patterns) {
      const m=p.text.match(re);
      if (m?.[1]) {
        const value=oneLine(m[1]);
        if (value) return {value,page:p.page,source:`Página ${p.page}: ${value}`,confidence};
      }
    }
  }
  return {value:null as string|null,page:null as number|null,source:'Não localizado nas páginas relevantes',confidence:'low' as Confidence};
}

function normalizeCompany(v:string|null):string|null {
  if (!v) return null;
  return oneLine(v)
    .replace(/^OPE_\d+\s*-\s*/i,'')
    .replace(/\s{2,}/g,' ')
    .trim();
}

function normalizeContainers(v:string|null):string|null {
  if (!v) return null;
  const matches=[...v.matchAll(/\b[A-Z]{4}\d{7}\b/g)].map(m=>m[0]);
  const unique=[...new Set(matches)];
  return unique.length?unique.join(' / '):oneLine(v);
}

function analyzePages(pages:PdfPage[], total:number, filename:string):Analysis {
  const full=pages.map(p=>p.text).join('\n');
  const values:Record<string,ReturnType<typeof find>>={};
  const set=(key:string, patterns:RegExp[], confidence:Confidence='high')=>{ values[key]=find(pages,patterns,confidence); };
  const fixed=(key:string,value:string|null,page:number|null,source:string,confidence:Confidence='high')=>{
    values[key]={value,page,source,confidence:value?confidence:'low'};
  };

  const processType:/IMPORTAÇÃO|EXPORTAÇÃO|NÃO IDENTIFICADO/ = /\bDUIMP\b|Nome do importador|Importa[cç][aã]o/i.test(full)
    ? 'IMPORTAÇÃO'
    : (/\bDUE\b|Nome do exportador|Exporta[cç][aã]o/i.test(full)?'EXPORTAÇÃO':'NÃO IDENTIFICADO');

  set('cliente',[
    /Nome do importador:\s*\n?\s*([^\n]+)/i,
    /Consignee[^\n]*\n\s*([^\n]+)/i
  ]);

  fixed('tipo_documento',
    /Extrato da Duimp|\bDUIMP\b/i.test(full)?'DUIMP':(/\bDUE\b/i.test(full)?'DUE':(/BILL OF LADING|B\/L No/i.test(full)?'BL':null)),
    /Extrato da Duimp|\bDUIMP\b/i.test(full)?4:1,
    'Tipo identificado diretamente no documento'
  );

  set('remetente',[
    /Consignor\/Shipper\s*\n\s*([^\n]+)/i,
    /Shipper\s*\n\s*([^\n]+)/i,
    /C[oó]digo do Exportador Estrangeiro:\s*\n?\s*(?:OPE_\d+\s*-\s*)?([^\n]+)/i
  ]);
  if (values.remetente?.value) values.remetente.value=normalizeCompany(values.remetente.value);

  set('agencia_maritima',[
    /\b(HYUNDAI\s+GLOVIS\s+CO\.?\s*,?\s*LTD\.?)\b/i,
    /\b([A-Z][A-Z .,&'-]{3,70}\s+(?:CO\.?\s*,?\s*LTD\.?|SHIPPING\s+LINE|LINES))\b/i
  ]);

  set('numero_bl_awb',[
    /Conhecimento\.{0,10}:\s*([A-Z0-9-]{8,})/i,
    /B\/?L(?:\s*No\.?)?\s*[:#-]?\s*([A-Z0-9-]{8,})/i
  ]);

  set('local_armazenagem',[
    /Recinto Alfandeg[aá]rio\.{0,10}:\s*([^\n]+)/i,
    /Setor Alfandeg[aá]rio\.{0,10}:\s*([^\n]+)/i
  ]);

  set('ref_cliente',[
    /REF\.?\s*IMPORTADOR\.{0,10}:\s*([A-Z0-9./-]+)/i,
    /Nossa Refer[eê]ncia\.{0,10}:\s*([A-Z0-9./-]+)/i
  ]);

  set('numero_documento',[
    /Extrato da Duimp\s+([0-9A-Z-]{10,25})/i,
    /\bDUIMP\s*[:.]?\s*([0-9A-Z-]{10,25})/i
  ]);

  if (values.cliente?.value) {
    values.destinatario={...values.cliente,source:`Importador identificado: ${values.cliente.value}`,confidence:'high'};
  } else {
    set('destinatario',[/Consignee[^\n]*\n\s*([^\n]+)/i]);
  }

  set('porto_origem',[
    /Port of Loading\s*\n\s*([^\n]+)/i,
    /Port of Loading[^\n]{0,60}?\b([A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,30})\b/i
  ]);

  fixed('operacao_maritima',
    processType==='IMPORTAÇÃO'?'Importação':(processType==='EXPORTAÇÃO'?'Exportação':null),
    values.numero_documento?.page||null,
    processType==='NÃO IDENTIFICADO'?'Não foi possível identificar a operação':'Operação definida pelo documento aduaneiro'
  );

  set('cnpj_cliente',[/CNPJ do importador:\s*\n?\s*([0-9./-]+)/i,/CNPJ\s*[:.]?\s*([0-9]{2}\.[0-9]{3}\.[0-9]{3}\/[0-9]{4}-[0-9]{2})/i]);

  set('conteineres',[/CONTEINER:\s*([^\n]+)/i,/Container No\.?[\s\S]{0,220}?((?:[A-Z]{4}\d{7}[\s\S]{0,120}){1,4})/i],'high');
  if (values.conteineres?.value) values.conteineres.value=normalizeContainers(values.conteineres.value);

  set('peso_liquido',[/Peso L[ií]quido \(kg\):\s*\n?\s*([0-9.,]+)/i]);
  if (values.peso_liquido?.value) values.peso_liquido.value=`${values.peso_liquido.value} kg`;

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
      <div className="eyebrow"><Zap size={15}/> Precisão focada nos campos necessários</div>
      <h1>Leia o processo.<br/><em>Preencha só o que importa.</em></h1>
      <p className="lead">O sistema analisa as páginas iniciais do DOC COMPLETO, com OCR na página 1, e retorna somente os 14 campos definidos para o cadastro.</p>
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
      <div className="toolbar"><div/><button className="secondary" onClick={()=>navigator.clipboard.writeText(report)}><Clipboard size={16}/> Copiar relatório</button></div>
      <div className="table"><div className="table-head"><span>Campo</span><span>Valor extraído</span><span>Confiança</span><span>Fonte</span><span/></div>
        {analysis.fields.map(f=><div className="row" key={f.key}><div><b>{f.label}</b>{f.edited&&<small className="edited">Editado</small>}</div><div>{f.value?<input value={f.value} onChange={e=>update(f.key,e.target.value)}/>:<span className="not-found">Não localizado</span>}</div><div><span className={`confidence ${f.confidence}`}>{f.confidence==='high'?'✓ Alta':'? Revisar'}</span></div><div className="source">{f.source}</div><button className="copy" onClick={()=>f.value&&navigator.clipboard.writeText(f.value)}><Clipboard size={15}/></button></div>)}
      </div>
    </section>}</main>
    <footer><span>CONCLUSÃO DE PROCESSOS · precisão focada</span><span>Somente campos necessários para o sistema</span></footer>
  </div>;
}
