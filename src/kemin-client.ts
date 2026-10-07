import { KEMIN_PROFILE } from './clients/kemin';
import { runKeminAnalysis, type KeminAnalysisSnapshot } from './clients/kemin-analysis';

export {};

const escapeHtml=(value:string)=>value.replace(/[&<>'"]/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
}[char]||char));

function bindKemin(){
  const panel=document.querySelector<HTMLElement>('.clients-panel');
  const content=panel?.querySelector<HTMLElement>('.clients-content-panel');
  const list=panel?.querySelector<HTMLElement>('.clients-list-view');
  const grid=list?.querySelector<HTMLElement>('.clients-grid');
  if(!panel||!content||!list||!grid)return false;
  if(grid.querySelector('.client-card-kemin'))return true;

  const card=document.createElement('button');
  card.type='button';
  card.className='client-card client-card-kemin';
  card.setAttribute('aria-label',`Abrir cliente ${KEMIN_PROFILE.name}`);
  card.innerHTML=`
    <span class="client-logo-image"><img src="${KEMIN_PROFILE.logo}" alt="Logo ${KEMIN_PROFILE.displayName}"></span>
    <strong>${KEMIN_PROFILE.name}</strong>
    <small>Lógica própria por cliente</small>
    <span class="client-capabilities" aria-label="Formatos aceitos"><span>PDFs</span></span>
  `;
  grid.appendChild(card);

  const detail=document.createElement('div');
  detail.className='client-detail-view kemin-detail-view';
  detail.setAttribute('aria-hidden','true');
  detail.innerHTML=`
    <button type="button" class="client-detail-back kemin-back">← Clientes</button>
    <div class="client-detail-head">
      <span class="client-detail-logo client-detail-logo-image"><img src="${KEMIN_PROFILE.logo}" alt="Logo ${KEMIN_PROFILE.displayName}"></span>
      <div>
        <span class="clients-kicker">Processo por cliente</span>
        <h2>${KEMIN_PROFILE.name}</h2>
        <p>${KEMIN_PROFILE.description}</p>
      </div>
    </div>
    <div class="kemin-mode-note"><b>DOCUMENTOS PDF</b><span>Envie um ou vários PDFs do processo. A leitura da KEMIN identifica os dados pelo conteúdo real dos documentos e mantém a lógica isolada dos outros clientes.</span></div>
    <div class="kemin-upload-grid">
      <label class="client-upload-card kemin-pdf-card">
        <input type="file" accept="application/pdf,.pdf" data-kemin-file="pdfs" multiple hidden>
        <button type="button" class="client-file-clear" data-kemin-clear aria-label="Remover PDFs">×</button>
        <span class="client-upload-icon">▤</span>
        <strong>DOCUMENTOS PDF</strong>
        <small>Selecione um ou vários PDFs</small>
        <em>clique para selecionar</em>
      </label>
    </div>
    <div class="client-mode-status kemin-mode-status" aria-live="polite">Selecione os PDFs do processo KEMIN.</div>
    <button type="button" class="client-analyze-button kemin-analyze-button" disabled>Analisar processo KEMIN</button>
  `;
  content.appendChild(detail);

  const report=document.createElement('div');
  report.className='client-report-view kemin-report-view';
  report.setAttribute('aria-hidden','true');
  content.appendChild(report);

  const pdfInput=detail.querySelector<HTMLInputElement>('[data-kemin-file="pdfs"]')!;
  const status=detail.querySelector<HTMLElement>('.kemin-mode-status')!;
  const analyzeButton=detail.querySelector<HTMLButtonElement>('.kemin-analyze-button')!;
  const upload=detail.querySelector<HTMLElement>('.kemin-pdf-card')!;
  const clear=detail.querySelector<HTMLButtonElement>('[data-kemin-clear]')!;

  const refresh=()=>{
    const files=Array.from(pdfInput.files||[]);
    upload.classList.toggle('selected',files.length>0);
    clear.hidden=files.length===0;
    const em=upload.querySelector<HTMLElement>('em');
    if(em)em.textContent=files.length===0?'clique para selecionar':files.length===1?files[0].name:`${files.length} PDFs selecionados`;
    status.textContent=files.length===0?'Selecione os PDFs do processo KEMIN.':files.length===1?`PDF selecionado: ${files[0].name}`:`${files.length} PDFs selecionados para a KEMIN.`;
    analyzeButton.disabled=files.length===0;
  };

  const hideOtherViews=()=>{
    panel.querySelectorAll<HTMLElement>('.clients-list-view,.client-detail-view,.client-report-view').forEach(view=>{
      view.classList.remove('active','leaving');view.setAttribute('aria-hidden','true');
    });
    panel.classList.remove('report-mode');
  };
  const showList=()=>{hideOtherViews();list.classList.add('active');list.setAttribute('aria-hidden','false')};
  const showDetail=()=>{hideOtherViews();detail.classList.add('active');detail.setAttribute('aria-hidden','false');detail.scrollTop=0;refresh()};

  const showReport=(analysis:KeminAnalysisSnapshot)=>{
    const rows=analysis.fields.map(field=>`
      <div class="client-report-row">
        <div class="client-report-field"><b>${escapeHtml(field.label)}</b><span>${escapeHtml(field.source)}</span></div>
        <div class="client-report-value">${escapeHtml(field.value)}</div>
        <div class="client-report-confidence">${escapeHtml(field.confidence)}</div>
      </div>`).join('');

    report.innerHTML=`
      <div class="client-report-toolbar">
        <button type="button" class="client-report-back kemin-report-back">← KEMIN</button>
        <button type="button" class="client-report-copy kemin-report-copy">Copiar relatório</button>
      </div>
      <div class="client-report-head">
        <span class="client-report-logo"><img src="${KEMIN_PROFILE.logo}" alt="Logo ${KEMIN_PROFILE.displayName}"></span>
        <div><span class="clients-kicker">Relatório por cliente</span><h2>Relatório KEMIN</h2><p><b>Cliente do relatório: KEMIN</b> · ${escapeHtml(analysis.summary)}</p></div>
      </div>
      <div class="client-report-metrics">
        <div><span>Cliente</span><b>KEMIN</b></div>
        <div><span>Operação</span><b>${escapeHtml(analysis.processType)}</b></div>
        <div><span>Campos</span><b>${analysis.found}/${analysis.total}</b></div>
      </div>
      <div class="client-report-table">${rows}</div>
      <button type="button" class="client-report-new kemin-report-new">Nova análise KEMIN</button>
    `;

    hideOtherViews();panel.classList.add('report-mode');report.classList.add('active');report.setAttribute('aria-hidden','false');report.scrollTop=0;
    report.querySelector('.kemin-report-back')?.addEventListener('click',showDetail);
    report.querySelector('.kemin-report-new')?.addEventListener('click',()=>{pdfInput.value='';showDetail()});
    report.querySelector('.kemin-report-copy')?.addEventListener('click',()=>{
      const text=['Cliente do relatório: KEMIN',`Operação: ${analysis.processType}`,'',...analysis.fields.map(f=>`${f.label}: ${f.value}\nFonte: ${f.source}`)].join('\n');
      void navigator.clipboard?.writeText(text);
    });
  };

  pdfInput.addEventListener('change',refresh);
  clear.hidden=true;
  clear.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();pdfInput.value='';refresh()});

  analyzeButton.addEventListener('click',async()=>{
    const files=Array.from(pdfInput.files||[]);
    if(!files.length){refresh();return;}
    try{
      analyzeButton.disabled=true;
      analyzeButton.textContent='Analisando processo KEMIN...';
      status.textContent='Lendo e cruzando os PDFs da KEMIN...';
      const analysis=await runKeminAnalysis(files);
      showReport(analysis);
    }catch(error){
      status.textContent=error instanceof Error?error.message:'Não foi possível concluir a análise KEMIN.';
    }finally{
      analyzeButton.textContent='Analisar processo KEMIN';
      refresh();
    }
  });

  card.addEventListener('click',showDetail);
  detail.querySelector('.kemin-back')?.addEventListener('click',showList);
  document.querySelector('.clients-tab')?.addEventListener('click',()=>{detail.classList.remove('active');report.classList.remove('active')});
  document.querySelector('.clients-back-tab')?.addEventListener('click',()=>{detail.classList.remove('active');report.classList.remove('active')});
  refresh();
  return true;
}

if(!bindKemin()){
  const startupObserver=new MutationObserver(()=>{if(bindKemin())startupObserver.disconnect()});
  startupObserver.observe(document.documentElement,{childList:true,subtree:true});
}
