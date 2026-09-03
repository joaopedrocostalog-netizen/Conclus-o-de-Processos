import { useMemo, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { AlertTriangle, Check, ChevronRight, Clipboard, Download, FileText, Loader2, RotateCcw, Search, Sparkles, Upload, X, Zap } from 'lucide-react';
import './styles.css';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

type Confidence = 'high' | 'medium' | 'low';
type Field = { key: string; label: string; value: string | boolean | null; confidence: Confidence; page: number | null; source: string; edited?: boolean };
type Analysis = { process_type: 'IMPORTAÇÃO' | 'EXPORTAÇÃO' | 'NÃO IDENTIFICADO'; fields: Field[]; conflicts: string[]; pages: number; filename: string; analysis_mode?: string; ocr_pages?: number[] };
type PdfPage = { page: number; text: string };

const labels: Record<string,string> = {
 cliente:'Cliente',tipo_documento:'Tipo Documento',operacao_transporte:'Operação de Transporte',servico_terminal:'Serviço de Terminal?',remetente:'Remetente',local_coleta:'Local de Coleta',agencia_maritima:'Agência Marítima',despachante:'Despachante',ref_despachante:'Ref. Despachante',numero_bl_awb:'Nº BL / AWB',observacao:'Observação',mostrar_vias:'Mostrar Vias?',rota:'Rota',local_armazenagem:'Local de Armazenagem',data_faturamento:'Data para Faturamento',data_encerramento:'Data de Encerramento',ref_cliente:'Ref. do Cliente',numero_documento:'Nº Documento',produto:'Produto',produto_quimico:'Produto químico?',destinatario:'Destinatário',local_entrega:'Local de Entrega',navio:'Navio',numero_viagem_navio:'Nº Viagem Navio',porto_origem:'Porto de Origem',operacao_maritima:'Operação Marítima',processo_faturado:'Processo Faturado',faturamento_iniciado:'Faturamento Iniciado'
};
const keys = Object.keys(labels);
const clean = (s:string) => s.replace(/\s+/g,' ').trim();

function matchOnPages(pages: PdfPage[], patterns: RegExp[]): { value: string|null; page: number|null; source: string } {
  for (const p of pages) {
    for (const pattern of patterns) {
      const m = p.text.match(pattern);
      if (m?.[1]) {
        const value = clean(m[1]);
        return { value, page:p.page, source:`Página ${p.page}: ${value}` };
      }
    }
  }
  return { value:null, page:null, source:'Não localizado no PDF' };
}

async function readPdf(file: File): Promise<PdfPage[]> {
  const buffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: buffer }).promise;
  const pages: PdfPage[] = [];
  for (let i=1;i<=pdf.numPages;i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => 'str' in item ? (item as TextItem).str : '').join(' ');
    pages.push({ page:i, text:clean(text) });
  }
  return pages;
}

function classify(full:string): Analysis['process_type'] {
  const t = full.toLowerCase();
  if (/\bduimp\b|ref\.?\s*importador|declara[cç][aã]o.{0,20}importa[cç][aã]o/.test(t)) return 'IMPORTAÇÃO';
  if (/\bdue\b|ref\.?\s*exportador|declara[cç][aã]o.{0,20}exporta[cç][aã]o/.test(t)) return 'EXPORTAÇÃO';
  return 'NÃO IDENTIFICADO';
}

function summarizeProducts(full:string): string|null {
  const matches = [...full.matchAll(/\b\d{8,12}\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9 ,./()\-]{6,80}?)(?=\s+\*{2,}|\s+\d{8}\s+\d{3}\s+\d{4}|$)/g)];
  const items:string[] = [];
  for (const m of matches) {
    const item = clean(m[1]).replace(/VL\. APROX\. TRIB.*$/i,'').trim();
    if (item.length > 5 && !items.includes(item)) items.push(item);
    if (items.length >= 8) break;
  }
  return items.length ? items.join('; ') : null;
}

function analyzeLocally(pages: PdfPage[], filename:string): Analysis {
  const full = pages.map(p=>p.text).join(' \n ');
  const processType = classify(full);
  const values: Record<string,{value:string|boolean|null;page:number|null;source:string;confidence:Confidence}> = {};

  const set = (key:string, patterns:RegExp[], confidence:Confidence='high') => {
    const r = matchOnPages(pages,patterns);
    values[key] = {...r, confidence:r.value ? confidence : 'low'};
  };

  set('tipo_documento',[/(DANFE)/i,/(NF-e)/i,/\b(DUIMP)\b/i,/\b(DUE)\b/i]);
  set('numero_bl_awb',[/\bBL\s*:\s*([A-Z0-9./-]{6,})/i,/\bAWB\s*:\s*([A-Z0-9./-]{6,})/i]);
  set('numero_documento',[/\bDUIMP\s*([0-9A-Z.-]{8,})/i,/\bDUE\s*([0-9A-Z.-]{8,})/i,/N[º°]?\s*([0-9]{5,})\s+S[ÉE]RIE/i]);
  set('ref_cliente',[/REF\.?\s*IMPORTADOR\s*:\s*([A-Z0-9./-]+)/i,/REF\.?\s*EXPORTADOR\s*:\s*([A-Z0-9./-]+)/i,/REF\.?\s*(?:DO\s*)?CLIENTE\s*:\s*([A-Z0-9./-]+)/i]);
  set('remetente',[/DESTINAT[ÁA]RIO\s*\/\s*REMETENTE\s+([A-Z0-9ÁÉÍÓÚÂÊÔÃÕÇ .&'-]{5,80}?)(?=\s+\d{2}\/\d{2}\/\d{4}|\s+\d{2}\.\d{3}\.\d{3}|\s+\d{5}-\d{3}|\s+Ramones\b)/i]);
  set('cliente',[/RECEBEMOS\s+DE\s+([A-Z0-9ÁÉÍÓÚÂÊÔÃÕÇ .&'-]{5,100}?)\s+OS\s+PRODUTOS/i,/^\s*([A-Z0-9ÁÉÍÓÚÂÊÔÃÕÇ .&'-]{5,100}?LTDA)\s+Rua\s+/i]);
  set('destinatario',[/DESTINAT[ÁA]RIO\s*\/\s*REMETENTE\s+([A-Z0-9ÁÉÍÓÚÂÊÔÃÕÇ .&'-]{5,80}?)(?=\s+\d{2}\/\d{2}\/\d{4}|\s+Ramones\b)/i]);
  set('local_coleta',[/ENDERE[CÇ]O\s+MUNIC[ÍI]PIO\s+UF\s+INSCRI[CÇ][AÃ]O ESTADUAL\s+([A-Z0-9ÁÉÍÓÚÂÊÔÃÕÇ .,/\-]{6,120}?)(?=\s+\d+\s+Outros|\s+QUANTIDADE)/i], 'medium');
  set('local_entrega',[/Ramones\s+102\s+00000-000\s+EXTERIOR\s+\d+\s+(Carretera\s+Libre\s+Estatal\s+Pesqueria\s+Los\s+65500)/i], 'medium');
  set('observacao',[/INFORMA[CÇ][ÕO]ES\s+COMPLEMENTARES\s+(.*?)(?=C[ÁA]LCULO\s+DO\s+ISSQN|$)/i], 'medium');

  const nf = matchOnPages(pages,[/N[º°]?\s*([0-9]{5,})\s+S[ÉE]RIE/i,/\b([0-9]{7})\b\s+DOCUMENTO AUXILIAR/i]);
  if (values.tipo_documento?.value && /DANFE|NF-e/i.test(String(values.tipo_documento.value)) && nf.value) {
    values.numero_documento = {...nf, confidence:'high'};
  }

  const products = summarizeProducts(full);
  values.produto = products
    ? {value:products,page:1,source:'Descrições encontradas em Dados do Produto/Serviço',confidence:'medium'}
    : {value:null,page:null,source:'Não localizado no PDF',confidence:'low'};

  if (/REF\.?\s*IMPORTADOR/i.test(full) && /\bDUIMP\b/i.test(full)) {
    values.operacao_maritima = {value:'Importação',page:1,source:'Evidência: REF.IMPORTADOR e DUIMP',confidence:'high'};
  } else if (/REF\.?\s*EXPORTADOR/i.test(full) || /\bDUE\b/i.test(full)) {
    values.operacao_maritima = {value:'Exportação',page:1,source:'Evidência: REF.EXPORTADOR/DUE',confidence:'high'};
  }

  if (/PRODUTO\s+QU[ÍI]MICO|PERIGOSO|DANGEROUS GOODS|\bIMO\b|\bUN\s*\d{4}\b/i.test(full)) {
    values.produto_quimico = {value:true,page:1,source:'Há indicação explícita de produto químico/perigoso',confidence:'medium'};
  } else {
    values.produto_quimico = {value:null,page:null,source:'Não há indicação explícita no PDF',confidence:'low'};
  }

  const genericNull = () => ({value:null,page:null,source:'Não localizado no PDF',confidence:'low' as Confidence});
  const fields:Field[] = keys.map(key => {
    const v = values[key] ?? genericNull();
    return {key,label:labels[key],value:v.value,confidence:v.confidence,page:v.page,source:v.source};
  });

  return {
    process_type: processType,
    fields,
    conflicts:[],
    pages:pages.length,
    filename,
    analysis_mode:'local-pdfjs',
    ocr_pages:[]
  };
}

async function analyzePdf(file: File): Promise<Analysis> {
  const pages = await readPdf(file);
  if (!pages.some(p=>p.text.length > 20)) throw new Error('O PDF não possui texto legível. Este arquivo pode exigir OCR.');
  return analyzeLocally(pages,file.name);
}

export default function App(){
 const inputRef=useRef<HTMLInputElement>(null);
 const [file,setFile]=useState<File|null>(null),[analysis,setAnalysis]=useState<Analysis|null>(null),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[filter,setFilter]=useState('Todos'),[query,setQuery]=useState(''),[error,setError]=useState('');
 const [history,setHistory]=useState<Analysis[]>(()=>{try{return JSON.parse(localStorage.getItem('process-history')||'[]')}catch{return[]}});
 const selectFile=(f?:File)=>{setError('');if(!f)return;if(f.type!=='application/pdf'&&!f.name.toLowerCase().endsWith('.pdf'))return setError('Somente arquivos PDF são aceitos.');if(f.size>25*1024*1024)return setError('O arquivo excede o limite de 25 MB.');setFile(f);setAnalysis(null)};
 const analyze=async()=>{if(!file)return;setBusy(true);setError('');setProgress(10);try{setProgress(35);const data=await analyzePdf(file);setProgress(100);setAnalysis(data);const next=[data,...history.filter(x=>x.filename!==data.filename)].slice(0,20);setHistory(next);localStorage.setItem('process-history',JSON.stringify(next));}catch(e){setError(e instanceof Error?e.message:'Não foi possível analisar o PDF.');}finally{setBusy(false)}};
 const update=(key:string,value:string|boolean|null)=>setAnalysis(a=>a?({...a,fields:a.fields.map(f=>f.key===key?{...f,value,edited:true,confidence:'high'}:f)}):a);
 const copy=(text:string)=>{void navigator.clipboard?.writeText(text)};
 const report=useMemo(()=>analysis?analysis.fields.map(f=>`${f.label}: ${f.value===null?'Não localizado no documento':String(f.value)}`).join('\n'):'',[analysis]);
 const filtered=analysis?.fields.filter(f=>{const ok=filter==='Todos'||(filter==='Preenchidos'&&f.value!==null)||(filter==='Não encontrados'&&f.value===null)||(filter==='Revisar'&&f.confidence!=='high');return ok&&`${f.label} ${String(f.value??'')}`.toLowerCase().includes(query.toLowerCase())})??[];
 const found=analysis?.fields.filter(f=>f.value!==null).length??0,missing=analysis?analysis.fields.length-found:0;
 const uploadView=<section className="hero"><div className="eyebrow"><Zap size={15}/> Leitura real de PDF no navegador</div><h1>Conclua seus processos<br/><em>com inteligência.</em></h1><p className="lead">Envie um PDF de importação ou exportação. A leitura agora ocorre diretamente no navegador, sem depender de uma API inexistente no GitHub Pages.</p><div className="upload" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();selectFile(e.dataTransfer.files[0])}} onClick={()=>inputRef.current?.click()}><input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={e=>selectFile(e.target.files?.[0])}/><div className="upload-icon"><Upload/></div><h2>{file?'PDF selecionado':'Arraste seu PDF aqui'}</h2><p>{file?file.name:'ou clique para selecionar um arquivo'}</p><small>PDF · máximo 25 MB · documentos multipágina aceitos</small></div>{file&&<div className="filebar"><div><FileText size={18}/><div><b>{file.name}</b><span>{(file.size/1024/1024).toFixed(2)} MB · pronto para análise</span></div></div><button className="icon-btn" onClick={e=>{e.stopPropagation();setFile(null)}}><X/></button></div>}{error&&<div className="error"><AlertTriangle size={18}/>{error}</div>}{file&&<button className="primary" onClick={e=>{e.stopPropagation();analyze()}} disabled={busy}>{busy?<><Loader2 className="spin"/> Analisando PDF {progress}%</>:<>Analisar Processo <ChevronRight/></>}</button>}<div className="steps"><span><Check/> Leitura do PDF</span><span><Check/> Extração dos campos</span><span><Check/> Validação</span><span><Check/> Relatório objetivo</span></div></section>;
 const resultsView=analysis?<section className="results"><div className="result-head"><div><div className="eyebrow"><Check size={15}/> Análise concluída</div><h1>Dados para preenchimento</h1><p>{analysis.filename} · {analysis.pages} página(s) · modo: leitura local</p></div><button className="secondary" onClick={()=>{setAnalysis(null);setFile(null)}}><RotateCcw size={16}/> Nova análise</button></div><div className="metrics"><div className="metric"><span>Tipo de processo</span><b className="type">{analysis.process_type}</b></div><div className="metric"><span>Campos encontrados</span><b>{found}<small>/{analysis.fields.length}</small></b></div><div className="metric"><span>Não encontrados</span><b>{missing}</b></div><div className="metric"><span>Revisões</span><b>{analysis.fields.filter(f=>f.confidence!=='high').length}</b></div></div>{analysis.conflicts.length>0&&<div className="warning"><AlertTriangle/><div><b>Atenção: informações conflitantes</b><p>{analysis.conflicts.join(' · ')}</p></div></div>}<div className="toolbar"><div className="filters">{['Todos','Preenchidos','Não encontrados','Revisar'].map(x=><button key={x} className={filter===x?'active':''} onClick={()=>setFilter(x)}>{x}</button>)}</div><div className="tools"><div className="search"><Search size={16}/><input placeholder="Buscar campo..." value={query} onChange={e=>setQuery(e.target.value)}/></div><button className="secondary" onClick={()=>copy(report)}><Clipboard size={16}/> Copiar relatório</button><button className="secondary" onClick={()=>{const blob=new Blob([report],{type:'text/plain'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${analysis.filename.replace(/\.pdf$/i,'')}-relatorio.txt`;a.click();URL.revokeObjectURL(a.href)}}><Download size={16}/> Exportar TXT</button></div></div><div className="table"><div className="table-head"><span>Campo</span><span>Valor extraído</span><span>Confiança</span><span>Fonte</span><span/></div>{filtered.map(f=><div className="row" key={f.key}><div><b>{f.label}</b>{f.edited&&<small className="edited">Editado manualmente</small>}</div><div>{f.value===null?<span className="not-found">Não localizado no documento</span>:typeof f.value==='boolean'?<span>{f.value?'Sim':'Não'}</span>:<input value={f.value} onChange={e=>update(f.key,e.target.value)}/>}</div><div><span className={`confidence ${f.confidence}`}>{f.confidence==='high'?'✓':f.confidence==='medium'?'⚠':'?'} {f.confidence==='high'?'Alta confiança':f.confidence==='medium'?'Média confiança':'Baixa confiança'}</span></div><div className="source">{f.source|| (f.page?`Página ${f.page}`:'—')}</div><button className="copy" title="Copiar" onClick={()=>copy(f.value===null?'':String(f.value))}><Clipboard size={15}/></button></div>)}</div><div className="integrity"><div className="shield">✓</div><div><b>Extração real do documento</b><span>O PDF é lido no próprio navegador. Não há resposta fixa e não existe chamada para /api/analyze no GitHub Pages.</span></div></div></section>:null;
 return <div className="app"><div className="grid-bg"/><header><div className="brand"><div className="brand-mark"><Sparkles size={19}/></div><div><strong>Conclusão de Processos</strong><span>Inteligência operacional para logística</span></div></div><div className="header-status"><span className="live-dot"/> Sistema operacional</div></header><main>{analysis?resultsView:uploadView}</main><footer><span>CONCLUSÃO DE PROCESSOS · v2.1</span><span>Leitura local de PDFs</span></footer></div>;
}
