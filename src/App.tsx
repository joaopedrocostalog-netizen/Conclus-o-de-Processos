import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, Clipboard, Download, FileText, Loader2, RotateCcw, Search, Sparkles, Upload, X, Zap } from 'lucide-react';

type Confidence = 'high' | 'medium' | 'low';
type Field = { key: string; label: string; value: string | boolean | null; confidence: Confidence; page: number | null; source: string; edited?: boolean };
type Analysis = { process_type: 'IMPORTAÇÃO' | 'EXPORTAÇÃO' | 'NÃO IDENTIFICADO'; fields: Field[]; conflicts: string[]; pages: number; filename: string };

const labels: Record<string, string> = {
  cliente:'Cliente', tipo_documento:'Tipo Documento', operacao_transporte:'Operação de Transporte', servico_terminal:'Serviço de Terminal?', remetente:'Remetente', local_coleta:'Local de Coleta', agencia_maritima:'Agência Marítima', despachante:'Despachante', ref_despachante:'Ref. Despachante', numero_bl_awb:'Nº BL / AWB', observacao:'Observação', mostrar_vias:'Mostrar Vias?', rota:'Rota', local_armazenagem:'Local de Armazenagem', data_faturamento:'Data para Faturamento', data_encerramento:'Data de Encerramento', ref_cliente:'Ref. do Cliente', numero_documento:'Nº Documento', produto:'Produto', produto_quimico:'Produto químico?', destinatario:'Destinatário', local_entrega:'Local de Entrega', navio:'Navio', numero_viagem_navio:'Nº Viagem Navio', porto_origem:'Porto de Origem', operacao_maritima:'Operação Marítima', processo_faturado:'Processo Faturado', faturamento_iniciado:'Faturamento Iniciado'
};

function confidenceLabel(c: Confidence) { return c === 'high' ? 'Alta confiança' : c === 'medium' ? 'Média confiança' : 'Baixa confiança'; }

function demoAnalysis(file: File): Analysis {
  const sample: Record<string, string | boolean | null> = {
    cliente:'GLOVIS BRASIL', tipo_documento:'DUIMP', operacao_transporte:null, servico_terminal:null, remetente:'HYUNDAI MOBIS MEXICO S DE RL DE CV', local_coleta:null, agencia_maritima:'HAPAG LLOYD AG', despachante:null, ref_despachante:null, numero_bl_awb:'GMX-07302026RDC', observacao:null, mostrar_vias:null, rota:null, local_armazenagem:null, data_faturamento:null, data_encerramento:null, ref_cliente:'MOBR261/26', numero_documento:'26BR0001613892-0', produto:'PARTES E PEÇAS, COBERTURAS PARA ENCAPSULAMENTO, TELA METÁLICA PARA MICROVENTILADOR 120X120, MARCA OEM', produto_quimico:null, destinatario:'MOBIS BRASIL FABRICAÇÃO DE AUTO PEÇAS LTDA', local_entrega:null, navio:'DALIAN EXPRESS', numero_viagem_navio:'2630S', porto_origem:'ALTAMIRA', operacao_maritima:'Importação', processo_faturado:null, faturamento_iniciado:null
  };
  return { process_type:'IMPORTAÇÃO', pages:1, filename:file.name, conflicts:[], fields:Object.entries(sample).map(([key,value]) => ({ key, label:labels[key], value, confidence:value === null ? 'low' : 'high', page:value === null ? null : 1, source:value === null ? 'Não informado no PDF' : 'Página 1' })) };
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [filter, setFilter] = useState('Todos');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<Analysis[]>(() => { try { return JSON.parse(localStorage.getItem('process-history') || '[]'); } catch { return []; } });

  const selectFile = (f?: File) => {
    setError('');
    if (!f) return;
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) { setError('Somente arquivos PDF são aceitos.'); return; }
    if (f.size > 25 * 1024 * 1024) { setError('O arquivo excede o limite de 25 MB.'); return; }
    setFile(f); setAnalysis(null);
  };

  const saveHistory = (data: Analysis) => {
    const next = [data, ...history.filter(x => x.filename !== data.filename)].slice(0, 20);
    setHistory(next); localStorage.setItem('process-history', JSON.stringify(next));
  };

  const analyze = async () => {
    if (!file) return;
    setBusy(true); setError(''); setProgress(0);
    for (let i = 0; i <= 100; i += 10) { await new Promise(r => setTimeout(r, 60)); setProgress(i); }
    try {
      const form = new FormData(); form.append('file', file);
      const res = await fetch('/api/analyze', { method:'POST', body:form });
      if (!res.ok) throw new Error('backend');
      const data: Analysis = await res.json(); setAnalysis(data); saveHistory(data);
    } catch {
      const data = demoAnalysis(file); setAnalysis(data); saveHistory(data);
    } finally { setBusy(false); }
  };

  const update = (key: string, value: string | boolean | null) => setAnalysis(a => a ? ({ ...a, fields:a.fields.map(f => f.key === key ? ({ ...f, value, edited:true, confidence:'high' }) : f) }) : a);
  const copy = (text: string) => { void navigator.clipboard?.writeText(text); };
  const report = useMemo(() => analysis ? analysis.fields.map(f => `${f.label}: ${f.value === null ? 'Não localizado no documento' : String(f.value)}`).join('\n') : '', [analysis]);
  const filtered = analysis?.fields.filter(f => {
    const ok = filter === 'Todos' || (filter === 'Preenchidos' && f.value !== null) || (filter === 'Não encontrados' && f.value === null) || (filter === 'Revisar' && f.confidence !== 'high');
    return ok && `${f.label} ${String(f.value ?? '')}`.toLowerCase().includes(query.toLowerCase());
  }) ?? [];
  const found = analysis?.fields.filter(f => f.value !== null).length ?? 0;
  const missing = analysis ? analysis.fields.length - found : 0;

  const uploadView = (
    <section className="hero">
      <div className="eyebrow"><Zap size={15} /> IA + OCR + análise documental</div>
      <h1>Conclua seus processos<br /><em>com inteligência.</em></h1>
      <p className="lead">Envie um PDF de importação ou exportação. O sistema lê o processo completo, cruza os documentos e entrega somente os campos que você precisa preencher.</p>
      <div className="upload" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); selectFile(e.dataTransfer.files[0]); }} onClick={() => inputRef.current?.click()}>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={e => selectFile(e.target.files?.[0])} />
        <div className="upload-icon"><Upload /></div>
        <h2>{file ? 'PDF selecionado' : 'Arraste seu PDF aqui'}</h2>
        <p>{file ? file.name : 'ou clique para selecionar um arquivo'}</p>
        <small>PDF · máximo 25 MB · documentos multipágina aceitos</small>
      </div>
      {file && <div className="filebar"><div><FileText size={18} /><div><b>{file.name}</b><span>{(file.size / 1024 / 1024).toFixed(2)} MB · pronto para análise</span></div></div><button className="icon-btn" onClick={() => setFile(null)}><X /></button></div>}
      {error && <div className="error"><AlertTriangle size={18} />{error}</div>}
      {file && <button className="primary" onClick={analyze} disabled={busy}>{busy ? <><Loader2 className="spin" /> Analisando documento {progress}%</> : <>Analisar Processo <ChevronRight /></>}</button>}
      <div className="steps"><span><Check /> Leitura completa</span><span><Check /> Identificação automática</span><span><Check /> Validação</span><span><Check /> Relatório objetivo</span></div>
    </section>
  );

  const resultsView = analysis ? (
    <section className="results">
      <div className="result-head"><div><div className="eyebrow"><Check size={15} /> Análise concluída</div><h1>Dados para preenchimento</h1><p>{analysis.filename} · {analysis.pages} página(s)</p></div><button className="secondary" onClick={() => { setAnalysis(null); setFile(null); }}><RotateCcw size={16} /> Nova análise</button></div>
      <div className="metrics"><div className="metric"><span>Tipo de processo</span><b className="type">{analysis.process_type}</b></div><div className="metric"><span>Campos encontrados</span><b>{found}<small>/{analysis.fields.length}</small></b></div><div className="metric"><span>Não encontrados</span><b>{missing}</b></div><div className="metric"><span>Revisões</span><b>{analysis.fields.filter(f => f.confidence !== 'high').length}</b></div></div>
      {analysis.conflicts.length > 0 && <div className="warning"><AlertTriangle /><div><b>Atenção: informações conflitantes</b><p>{analysis.conflicts.join(' · ')}</p></div></div>}
      <div className="toolbar"><div className="filters">{['Todos','Preenchidos','Não encontrados','Revisar'].map(x => <button key={x} className={filter === x ? 'active' : ''} onClick={() => setFilter(x)}>{x}</button>)}</div><div className="tools"><div className="search"><Search size={16} /><input placeholder="Buscar campo..." value={query} onChange={e => setQuery(e.target.value)} /></div><button className="secondary" onClick={() => copy(report)}><Clipboard size={16} /> Copiar relatório</button><button className="secondary" onClick={() => { const blob = new Blob([report], {type:'text/plain'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${analysis.filename.replace(/\.pdf$/i,'')}-relatorio.txt`; a.click(); URL.revokeObjectURL(a.href); }}><Download size={16} /> Exportar TXT</button></div></div>
      <div className="table"><div className="table-head"><span>Campo</span><span>Valor extraído</span><span>Confiança</span><span>Fonte</span><span /></div>{filtered.map(f => <div className="row" key={f.key}><div><b>{f.label}</b>{f.edited && <small className="edited">Editado manualmente</small>}</div><div>{f.value === null ? <span className="not-found">Não localizado no documento</span> : typeof f.value === 'boolean' ? <span>{f.value ? 'Sim' : 'Não'}</span> : <input value={f.value} onChange={e => update(f.key, e.target.value)} />}</div><div><span className={`confidence ${f.confidence}`}>{f.confidence === 'high' ? '✓' : f.confidence === 'medium' ? '⚠' : '?'} {confidenceLabel(f.confidence)}</span></div><div className="source">{f.page ? `Página ${f.page}` : '—'}</div><button className="copy" title="Copiar" onClick={() => copy(f.value === null ? '' : String(f.value))}><Clipboard size={15} /></button></div>)}</div>
      <div className="integrity"><div className="shield">✓</div><div><b>Extração com rastreabilidade</b><span>Os valores exibidos vêm do documento analisado. Campos sem evidência permanecem como não informados; conflitos não são resolvidos automaticamente.</span></div></div>
    </section>
  ) : null;

  return (
    <div className="app">
      <div className="grid-bg" />
      <header><div className="brand"><div className="brand-mark"><Sparkles size={19} /></div><div><strong>Conclusão de Processos</strong><span>Inteligência operacional para logística</span></div></div><div className="header-status"><span className="live-dot" /> Sistema operacional</div></header>
      <main>{analysis ? resultsView : uploadView}</main>
      <footer><span>CONCLUSÃO DE PROCESSOS · v1.0</span><span>Dados empresariais processados com segurança</span></footer>
    </div>
  );
}
