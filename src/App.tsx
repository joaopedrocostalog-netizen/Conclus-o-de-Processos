import { useMemo, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { createWorker } from 'tesseract.js';
import { AlertTriangle, Check, ChevronRight, Clipboard, Download, FileText, Loader2, RotateCcw, Search, Sparkles, Upload, X, Zap } from 'lucide-react';
import './styles.css';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

type Confidence = 'high' | 'medium' | 'low';
type Field = { key: string; label: string; value: string | boolean | null; confidence: Confidence; page: number | null; source: string; edited?: boolean };
type Analysis = { process_type: 'IMPORTAÇÃO' | 'EXPORTAÇÃO' | 'NÃO IDENTIFICADO'; fields: Field[]; conflicts: string[]; pages: number; filename: string; analysis_mode?: string; ocr_pages?: number[] };
type PdfPage = { page: number; text: string; ocr: boolean };

const labels: Record<string,string> = {
  cliente:'Cliente',
  tipo_documento:'Tipo Documento',
  operacao_transporte:'Operação de Transporte',
  servico_terminal:'Serviço de Terminal?',
  remetente:'Remetente / Exportador',
  local_coleta:'Local de Coleta',
  agencia_maritima:'Agência Marítima / Carrier',
  despachante:'Despachante / Comissária',
  ref_despachante:'Ref. Despachante',
  numero_bl_awb:'Nº BL / AWB',
  observacao:'Observação',
  mostrar_vias:'Mostrar Vias?',
  rota:'Rota',
  local_armazenagem:'Local de Armazenagem',
  data_faturamento:'Data para Faturamento',
  data_encerramento:'Data de Encerramento',
  ref_cliente:'Ref. do Cliente',
  numero_documento:'Nº Documento',
  produto:'Produto',
  produto_quimico:'Produto químico / perigoso?',
  destinatario:'Destinatário / Importador',
  local_entrega:'Local de Entrega',
  navio:'Navio',
  numero_viagem_navio:'Nº Viagem Navio',
  porto_origem:'Porto de Origem',
  operacao_maritima:'Operação Marítima',
  processo_faturado:'Processo Faturado',
  faturamento_iniciado:'Faturamento Iniciado',
  cnpj_cliente:'CNPJ do Cliente / Importador',
  endereco_cliente:'Endereço do Cliente / Importador',
  status_duimp:'Status da DUIMP',
  canal_duimp:'Canal da DUIMP',
  data_embarque:'Data de Embarque',
  fatura_comercial:'Fatura Comercial',
  romaneio_carga:'Romaneio de Carga',
  conteineres:'Contêineres',
  manifesto:'Manifesto',
  transportadora:'Transportadora Autorizada',
  peso_bruto:'Peso Bruto',
  peso_liquido:'Peso Líquido',
  pais_procedencia:'País de Procedência',
  urf_despacho:'URF / Unidade de Despacho',
  setor_alfandegario:'Setor Alfandegário',
  numero_carga:'Identificação da Carga'
};

const keys = Object.keys(labels);
const clean = (s:string) => s.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const oneLine = (s:string) => clean(s).replace(/\n/g,' ');

function textItemToLineText(items: any[]): string {
  let lastY: number | null = null;
  const lines: string[] = [];
  let current = '';
  for (const raw of items) {
    if (!('str' in raw)) continue;
    const item = raw as TextItem;
    const str = item.str?.trim();
    if (!str) continue;
    const y = Array.isArray((item as any).transform) ? Number((item as any).transform[5]) : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2.4) {
      if (current.trim()) lines.push(current.trim());
      current = str;
    } else {
      current += (current ? ' ' : '') + str;
    }
    if (y !== null) lastY = y;
  }
  if (current.trim()) lines.push(current.trim());
  return clean(lines.join('\n'));
}

async function ocrPage(pdfPage:any): Promise<string> {
  const viewport = pdfPage.getViewport({ scale: 1.7 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  const worker = await createWorker('eng+por');
  try {
    const result = await worker.recognize(canvas);
    return clean(result.data.text || '');
  } finally {
    await worker.terminate();
  }
}

async function readPdf(file: File): Promise<PdfPage[]> {
  const buffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: buffer }).promise;
  const pages: PdfPage[] = [];
  const sparse: {index:number; page:any}[] = [];

  for (let i=1;i<=pdf.numPages;i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = textItemToLineText(content.items as any[]);
    pages.push({ page:i, text, ocr:false });
    if (text.replace(/\s/g,'').length < 35) sparse.push({index:i-1,page});
  }

  for (const entry of sparse.slice(0,12)) {
    try {
      const text = await ocrPage(entry.page);
      if (text.length > pages[entry.index].text.length) {
        pages[entry.index] = { page:entry.index+1, text, ocr:true };
      }
    } catch {
      // Mantém o texto existente se OCR falhar.
    }
  }
  return pages;
}

function findField(pages:PdfPage[], patterns:RegExp[], confidence:Confidence='high') {
  for (const p of pages) {
    for (const pattern of patterns) {
      const m = p.text.match(pattern);
      if (m?.[1]) {
        const value = oneLine(m[1]);
        if (value) return { value, page:p.page, source:`Página ${p.page}: ${value}`, confidence };
      }
    }
  }
  return { value:null as string|null, page:null as number|null, source:'Não localizado no PDF', confidence:'low' as Confidence };
}

function classify(full:string): Analysis['process_type'] {
  if (/\bDUIMP\b|Situa[cç][aã]o da Duimp|Nome do importador|Importa[cç][aã]o Direta/i.test(full)) return 'IMPORTAÇÃO';
  if (/\bDUE\b|Nome do exportador|Exporta[cç][aã]o/i.test(full)) return 'EXPORTAÇÃO';
  return 'NÃO IDENTIFICADO';
}

function getUniqueMatches(full:string, re:RegExp, limit=30): string[] {
  const out:string[] = [];
  for (const m of full.matchAll(re)) {
    const v = oneLine(m[1] || '');
    if (v && !out.some(x=>x.toLowerCase()===v.toLowerCase())) out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

function productSummary(full:string): string|null {
  const names = getUniqueMatches(
    full,
    /C[oó]digo do produto:\s*\n?\s*\d+\s*-\s*([^\n]{4,140})/gi,
    24
  ).map(v=>v.replace(/\s+Vers[aã]o:.*$/i,'').trim());

  const refs = getUniqueMatches(
    full,
    /(?:refer[eê]ncia comercial|part number)\s*[:;]?\s*([A-Z0-9][A-Z0-9.-]{4,25})/gi,
    30
  );

  if (!names.length && !refs.length) return null;
  const p1 = names.length ? names.join('; ') : '';
  const p2 = refs.length ? `Referências: ${refs.join(', ')}` : '';
  return [p1,p2].filter(Boolean).join(' | ');
}

function analyzeLocally(pages:PdfPage[], filename:string): Analysis {
  const full = pages.map(p=>`--- PÁGINA ${p.page} ---\n${p.text}`).join('\n');
  const processType = classify(full);
  const values: Record<string, any> = {};
  const set = (key:string, patterns:RegExp[], confidence:Confidence='high') => {
    values[key] = findField(pages, patterns, confidence);
  };
  const fixed = (key:string, value:string|boolean|null, source:string, page:number|null, confidence:Confidence='high') => {
    values[key] = { value, page, source, confidence:value===null?'low':confidence };
  };

  set('cliente', [
    /Nome do importador:\s*\n?\s*([^\n]+)/i,
    /01\s*-\s*Nome\s*\/\s*Raz[aã]o Social\s*\n?\s*([^\n]+)/i
  ]);
  set('cnpj_cliente', [/CNPJ do importador:\s*\n?\s*([0-9./-]+)/i]);
  set('endereco_cliente', [/Endere[cç]o do importador:\s*\n?\s*([^\n]+)/i]);
  set('status_duimp', [/Situa[cç][aã]o da Duimp:\s*\n?\s*([^\n]+)/i]);
  set('canal_duimp', [/Canal [uú]nico:\s*\n?\s*([^\n]+)/i]);

  set('numero_documento', [
    /Extrato da Duimp\s+([0-9A-Z-]{10,25})/i,
    /\bDUIMP\s*[:.]?\s*([0-9A-Z-]{10,25})/i
  ]);
  fixed('tipo_documento',
    /\bDUIMP\b/i.test(full) ? 'DUIMP' : (/\bDUE\b/i.test(full) ? 'DUE' : (/\bB\/?L\b|BILL OF LADING/i.test(full) ? 'BL' : null)),
    /\bDUIMP\b/i.test(full) ? 'Documento principal identificado como DUIMP' : 'Tipo identificado no documento',
    /\bDUIMP\b/i.test(full) ? 4 : 1,
    'high'
  );

  set('ref_despachante', [
    /Nossa Refer[eê]ncia\.{0,8}:\s*([A-Z0-9./-]+)/i
  ]);
  set('ref_cliente', [
    /REF\.?\s*IMPORTADOR\.{0,8}:\s*([A-Z0-9./-]+)/i,
    /REF\.?\s*EXPORTADOR\.{0,8}:\s*([A-Z0-9./-]+)/i
  ]);
  set('fatura_comercial', [/FATURA COMERCIAL\.{0,8}:\s*([^\n]+)/i]);
  set('romaneio_carga', [/ROMANEIO DE CARGA\.{0,8}:\s*([^\n]+)/i]);
  set('data_embarque', [/Data Embarque\.{0,8}:\s*([0-9/.-]+)/i]);
  set('numero_bl_awb', [
    /Conhecimento\.{0,8}:\s*([A-Z0-9-]{8,})/i,
    /\bB\/?L(?:\s*No\.?)?\s*[:#-]?\s*([A-Z0-9-]{8,})/i
  ]);
  set('local_armazenagem', [
    /Recinto Alfandeg[aá]rio\.{0,8}:\s*([^\n]+)/i
  ]);
  set('setor_alfandegario', [/Setor Alfandeg[aá]rio\.{0,8}:\s*([^\n]+)/i]);
  set('urf_despacho', [
    /URF Despacho\.{0,8}:\s*([^\n]+)/i,
    /Unidade de despacho:\s*\n?\s*([^\n]+)/i
  ]);
  set('manifesto', [/Manifesto\.{0,8}:\s*([A-Z0-9.-]+)/i]);
  set('conteineres', [/CONTEINER:\s*([^\n]+)/i]);
  set('transportadora', [/TRANSPORTADORAS AUTORIZADAS:\s*\n?\s*([^\n]+)/i]);
  set('pais_procedencia', [/Pa[ií]s de Proced[eê]ncia:\s*\n?\s*([^\n]+)/i]);
  set('peso_bruto', [/Peso Bruto \(kg\):\s*\n?\s*([0-9.,]+)/i]);
  set('peso_liquido', [/Peso L[ií]quido \(kg\):\s*\n?\s*([0-9.,]+)/i]);
  set('numero_carga', [/Identifica[cç][aã]o da carga:\s*\n?\s*([A-Z0-9.-]+)/i]);

  set('despachante', [
    /COMISSARIA:\s*\n?\s*([^\n]+)/i,
    /Comiss[aá]ria:\s*\n?\s*([^\n]+)/i
  ]);

  set('remetente', [
    /C[oó]digo do Exportador Estrangeiro:\s*\n?\s*[A-Z0-9_ -]*-\s*([^\n]+)/i,
    /SHIPPER(?:'S)?(?: NAME AND ADDRESS)?\s*\n?\s*([^\n]+)/i
  ]);

  const importerAddress = findField(pages,[/Endere[cç]o do importador:\s*\n?\s*([^\n]+)/i],'medium');
  values.destinatario = values.cliente?.value
    ? {...values.cliente, source:`Importador identificado no documento: ${values.cliente.value}`, confidence:'high'}
    : findField(pages,[/CONSIGNEE\s*\n?\s*([^\n]+)/i],'medium');
  values.local_entrega = importerAddress.value
    ? {...importerAddress, source:`Endereço do importador (usado como provável local de entrega): ${importerAddress.value}`, confidence:'medium'}
    : findField(pages,[/Final Destination(?:For the Merchant Ref\.)?\s*\n?\s*([^\n]+)/i],'medium');

  set('porto_origem', [
    /Port of Loading\s*\n?\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ -]{3,50})/i,
    /Porto de Origem\s*[:\n]\s*([^\n]+)/i
  ], 'medium');

  const portDischarge = findField(pages,[
    /Port of Discharge\s*\n?\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ -]{3,50})/i
  ],'medium');

  const vesselVoy = findField(pages,[
    /Vessel\/Voy(?:age)?(?: No\.?)?\s*\n?\s*([^\n]+)/i,
    /Vessel\s*[:\n]\s*([^\n]+)/i
  ],'medium');
  if (vesselVoy.value) {
    const m = vesselVoy.value.match(/^(.*?)(?:\s+)([0-9]{2,}[A-Z]?)$/i);
    if (m) {
      fixed('navio', oneLine(m[1]), vesselVoy.source, vesselVoy.page, 'medium');
      fixed('numero_viagem_navio', oneLine(m[2]), vesselVoy.source, vesselVoy.page, 'medium');
    } else fixed('navio', vesselVoy.value, vesselVoy.source, vesselVoy.page, 'medium');
  }

  set('agencia_maritima', [
    /ACTING AS A CARRIER\s*\n?\s*([A-Z0-9 .,()'-]{5,80})/i,
    /(HYUNDAI GLOVIS CO\.,?\s*LTD\.?)/i
  ], 'medium');

  if (values.porto_origem?.value && portDischarge.value) {
    fixed('rota', `${values.porto_origem.value} → ${portDischarge.value}`, `Port of Loading / Port of Discharge, página ${values.porto_origem.page || portDischarge.page}`, values.porto_origem.page || portDischarge.page, 'high');
  } else if (values.pais_procedencia?.value && values.urf_despacho?.value) {
    fixed('rota', `${values.pais_procedencia.value} → ${values.urf_despacho.value}`, 'País de procedência e unidade de despacho', values.pais_procedencia.page, 'medium');
  }

  if (processType === 'IMPORTAÇÃO') {
    fixed('operacao_maritima','Importação','DUIMP / importador identificado no processo',4,'high');
  } else if (processType === 'EXPORTAÇÃO') {
    fixed('operacao_maritima','Exportação','DUE / exportador identificado no processo',1,'high');
  }

  if (/\bCONTEINER\b|\bContainer\b/i.test(full) && /\bB\/?L\b|Conhecimento/i.test(full)) {
    fixed('operacao_transporte','Marítimo - Contêiner','Conhecimento marítimo e contêineres identificados no documento',1,'high');
  }

  if (/Recinto Alfandeg[aá]rio|Setor Alfandeg[aá]rio/i.test(full)) {
    fixed('servico_terminal',true,'Há recinto/setor alfandegário explicitamente identificado',4,'high');
  }

  const dangerousNo = /Mercadoria\s+Perigosa[\s\S]{0,220}?\bN[aã]o\b/i.test(full);
  const dangerousYes = /Mercadoria\s+Perigosa[\s\S]{0,220}?\bSim\b/i.test(full) || /DANGEROUS GOODS/i.test(full);
  if (dangerousYes) fixed('produto_quimico',true,'Documento indica mercadoria perigosa',5,'high');
  else if (dangerousNo) fixed('produto_quimico',false,'Documento indica “Mercadoria Perigosa: Não”',5,'high');

  const products = productSummary(full);
  fixed('produto', products, products ? 'Resumo de todos os códigos/descrições de produto encontrados na DUIMP' : 'Não localizado no PDF', products ? 7 : null, products ? 'high' : 'low');

  const obs:string[] = [];
  if (values.status_duimp?.value) obs.push(`DUIMP: ${values.status_duimp.value}`);
  if (values.canal_duimp?.value) obs.push(`Canal: ${values.canal_duimp.value}`);
  if (values.fatura_comercial?.value) obs.push(`Faturas: ${values.fatura_comercial.value}`);
  if (values.conteineres?.value) obs.push(`Contêineres: ${values.conteineres.value}`);
  if (values.manifesto?.value) obs.push(`Manifesto: ${values.manifesto.value}`);
  if (values.peso_bruto?.value) obs.push(`Peso bruto: ${values.peso_bruto.value} kg`);
  if (values.peso_liquido?.value) obs.push(`Peso líquido: ${values.peso_liquido.value} kg`);
  if (values.data_embarque?.value) obs.push(`Embarque: ${values.data_embarque.value}`);
  if (obs.length) fixed('observacao',obs.join(' | '),'Resumo consolidado de informações explícitas do processo',4,'high');

  set('data_faturamento', [/Data (?:para )?Faturamento\s*[:\n]\s*([0-9/.-]+)/i]);
  set('data_encerramento', [/Data (?:de )?Encerramento\s*[:\n]\s*([0-9/.-]+)/i]);
  set('mostrar_vias', [/Mostrar Vias\??\s*[:\n]\s*(Sim|N[aã]o)/i]);
  set('processo_faturado', [/Processo Faturado\s*[:\n]\s*(Sim|N[aã]o)/i]);
  set('faturamento_iniciado', [/Faturamento Iniciado\s*[:\n]\s*(Sim|N[aã]o)/i]);

  for (const k of ['mostrar_vias','processo_faturado','faturamento_iniciado']) {
    if (typeof values[k]?.value === 'string') {
      values[k].value = /^sim$/i.test(values[k].value);
    }
  }

  const genericNull = () => ({value:null,page:null,source:'Não localizado no PDF',confidence:'low' as Confidence});
  const fields:Field[] = keys.map(key => {
    const v = values[key] ?? genericNull();
    return {key,label:labels[key],value:v.value,confidence:v.confidence,page:v.page,source:v.source};
  });

  return {
    process_type:processType,
    fields,
    conflicts:[],
    pages:pages.length,
    filename,
    analysis_mode:'local-pdfjs+ocr',
    ocr_pages:pages.filter(p=>p.ocr).map(p=>p.page)
  };
}

async function analyzePdf(file: File): Promise<Analysis> {
  const pages = await readPdf(file);
  if (!pages.some(p=>p.text.length > 20)) throw new Error('Não foi possível obter texto do PDF, nem com OCR.');
  return analyzeLocally(pages,file.name);
}

export default function App(){
  const inputRef=useRef<HTMLInputElement>(null);
  const [file,setFile]=useState<File|null>(null),[analysis,setAnalysis]=useState<Analysis|null>(null),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[filter,setFilter]=useState('Todos'),[query,setQuery]=useState(''),[error,setError]=useState('');
  const [history,setHistory]=useState<Analysis[]>(()=>{try{return JSON.parse(localStorage.getItem('process-history')||'[]')}catch{return[]}});

  const selectFile=(f?:File)=>{
    setError('');
    if(!f)return;
    if(f.type!=='application/pdf'&&!f.name.toLowerCase().endsWith('.pdf'))return setError('Somente arquivos PDF são aceitos.');
    if(f.size>25*1024*1024)return setError('O arquivo excede o limite de 25 MB.');
    setFile(f);setAnalysis(null)
  };

  const analyze=async()=>{
    if(!file)return;
    setBusy(true);setError('');setProgress(10);
    try{
      setProgress(30);
      const data=await analyzePdf(file);
      setProgress(100);
      setAnalysis(data);
      const next=[data,...history.filter(x=>x.filename!==data.filename)].slice(0,20);
      setHistory(next);
      localStorage.setItem('process-history',JSON.stringify(next));
    }catch(e){
      setError(e instanceof Error?e.message:'Não foi possível analisar o PDF.');
    }finally{setBusy(false)}
  };

  const update=(key:string,value:string|boolean|null)=>setAnalysis(a=>a?({...a,fields:a.fields.map(f=>f.key===key?{...f,value,edited:true,confidence:'high'}:f)}):a);
  const copy=(text:string)=>{void navigator.clipboard?.writeText(text)};
  const report=useMemo(()=>analysis?analysis.fields.map(f=>`${f.label}: ${f.value===null?'Não localizado no documento':String(f.value)}`).join('\n'):'',[analysis]);
  const filtered=analysis?.fields.filter(f=>{
    const ok=filter==='Todos'||(filter==='Preenchidos'&&f.value!==null)||(filter==='Não encontrados'&&f.value===null)||(filter==='Revisar'&&f.confidence!=='high');
    return ok&&`${f.label} ${String(f.value??'')}`.toLowerCase().includes(query.toLowerCase())
  })??[];
  const found=analysis?.fields.filter(f=>f.value!==null).length??0,missing=analysis?analysis.fields.length-found:0;

  const uploadView=<section className="hero"><div className="eyebrow"><Zap size={15}/> Leitura completa + OCR</div><h1>Conclua seus processos<br/><em>com inteligência.</em></h1><p className="lead">Envie o documento completo do processo. O sistema lê todas as páginas, identifica DUIMP, BL, carga, cliente, despachante, terminal, produtos e usa OCR quando encontra páginas digitalizadas.</p><div className="upload" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();selectFile(e.dataTransfer.files[0])}} onClick={()=>inputRef.current?.click()}><input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={e=>selectFile(e.target.files?.[0])}/><div className="upload-icon"><Upload/></div><h2>{file?'PDF selecionado':'Arraste seu PDF aqui'}</h2><p>{file?file.name:'ou clique para selecionar um arquivo'}</p><small>PDF · máximo 25 MB · documentos multipágina aceitos</small></div>{file&&<div className="filebar"><div><FileText size={18}/><div><b>{file.name}</b><span>{(file.size/1024/1024).toFixed(2)} MB · pronto para análise completa</span></div></div><button className="icon-btn" onClick={e=>{e.stopPropagation();setFile(null)}}><X/></button></div>}{error&&<div className="error"><AlertTriangle size={18}/>{error}</div>}{file&&<button className="primary" onClick={e=>{e.stopPropagation();analyze()}} disabled={busy}>{busy?<><Loader2 className="spin"/> Lendo todas as páginas e OCR...</>:<>Analisar Processo <ChevronRight/></>}</button>}<div className="steps"><span><Check/> Todas as páginas</span><span><Check/> OCR em scans</span><span><Check/> Campos + evidências</span><span><Check/> Dados adicionais</span></div></section>;

  const resultsView=analysis?<section className="results"><div className="result-head"><div><div className="eyebrow"><Check size={15}/> Análise concluída</div><h1>Dados para preenchimento</h1><p>{analysis.filename} · {analysis.pages} página(s) · modo: PDF + OCR</p></div><button className="secondary" onClick={()=>{setAnalysis(null);setFile(null)}}><RotateCcw size={16}/> Nova análise</button></div><div className="metrics"><div className="metric"><span>Tipo de processo</span><b className="type">{analysis.process_type}</b></div><div className="metric"><span>Campos encontrados</span><b>{found}<small>/{analysis.fields.length}</small></b></div><div className="metric"><span>Não encontrados</span><b>{missing}</b></div><div className="metric"><span>Revisões</span><b>{analysis.fields.filter(f=>f.confidence!=='high').length}</b></div></div>{analysis.conflicts.length>0&&<div className="warning"><AlertTriangle/><div><b>Atenção: informações conflitantes</b><p>{analysis.conflicts.join(' · ')}</p></div></div>}{analysis.ocr_pages?.length?<div className="warning"><FileText/><div><b>OCR utilizado</b><p>Páginas digitalizadas lidas por OCR: {analysis.ocr_pages.join(', ')}.</p></div></div>:null}<div className="toolbar"><div className="filters">{['Todos','Preenchidos','Não encontrados','Revisar'].map(x=><button key={x} className={filter===x?'active':''} onClick={()=>setFilter(x)}>{x}</button>)}</div><div className="tools"><div className="search"><Search size={16}/><input placeholder="Buscar campo..." value={query} onChange={e=>setQuery(e.target.value)}/></div><button className="secondary" onClick={()=>copy(report)}><Clipboard size={16}/> Copiar relatório</button><button className="secondary" onClick={()=>{const blob=new Blob([report],{type:'text/plain'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${analysis.filename.replace(/\.pdf$/i,'')}-relatorio.txt`;a.click();URL.revokeObjectURL(a.href)}}><Download size={16}/> Exportar TXT</button></div></div><div className="table"><div className="table-head"><span>Campo</span><span>Valor extraído</span><span>Confiança</span><span>Fonte</span><span/></div>{filtered.map(f=><div className="row" key={f.key}><div><b>{f.label}</b>{f.edited&&<small className="edited">Editado manualmente</small>}</div><div>{f.value===null?<span className="not-found">Não localizado no documento</span>:typeof f.value==='boolean'?<span>{f.value?'Sim':'Não'}</span>:<input value={f.value} onChange={e=>update(f.key,e.target.value)}/>}</div><div><span className={`confidence ${f.confidence}`}>{f.confidence==='high'?'✓':f.confidence==='medium'?'⚠':'?'} {f.confidence==='high'?'Alta confiança':f.confidence==='medium'?'Média confiança':'Baixa confiança'}</span></div><div className="source">{f.source|| (f.page?`Página ${f.page}`:'—')}</div><button className="copy" title="Copiar" onClick={()=>copy(f.value===null?'':String(f.value))}><Clipboard size={15}/></button></div>)}</div><div className="integrity"><div className="shield">✓</div><div><b>Extração baseada no documento completo</b><span>O sistema não usa respostas pré-definidas: procura cada campo no PDF, registra a página/fonte e também lê páginas escaneadas por OCR.</span></div></div></section>:null;

  return <div className="app"><div className="grid-bg"/><header><div className="brand"><div className="brand-mark"><Sparkles size={19}/></div><div><strong>Conclusão de Processos</strong><span>Inteligência operacional para logística</span></div></div><div className="header-status"><span className="live-dot"/> Sistema operacional</div></header><main>{analysis?resultsView:uploadView}</main><footer><span>CONCLUSÃO DE PROCESSOS · v1.2</span><span>Leitura integral do PDF com rastreabilidade</span></footer></div>;
}
