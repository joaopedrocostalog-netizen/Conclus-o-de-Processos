import { CEVA_PROFILE } from './clients/ceva';
import { runCevaAnalysis, type CevaAnalysisSnapshot } from './clients/ceva-analysis';

export {};

const escapeHtml=(value:string)=>value.replace(/[&<>'"]/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
}[char]||char));

function bindCeva(){
  const panel=document.querySelector<HTMLElement>('.clients-panel');
  const content=panel?.querySelector<HTMLElement>('.clients-content-panel');
  const list=panel?.querySelector<HTMLElement>('.clients-list-view');
  const grid=list?.querySelector<HTMLElement>('.clients-grid');
  if(!panel||!content||!list||!grid)return false;
  if(grid.querySelector('.client-card-ceva'))return true;

  const card=document.createElement('button');
  card.type='button';
  card.className='client-card client-card-ceva';
  card.setAttribute('aria-label',`Abrir cliente ${CEVA_PROFILE.name}`);
  card.innerHTML=`
    <span class="client-logo-image"><img src="${CEVA_PROFILE.logo}" alt="Logo ${CEVA_PROFILE.displayName}"></span>
    <strong>${CEVA_PROFILE.name}</strong>
    <small>Lógica própria por cliente</small>
    <span class="client-capabilities" aria-label="Formatos aceitos"><span>PDFs</span></span>
  `;
  grid.appendChild(card);

  const detail=document.createElement('div');
  detail.className='client-detail-view ceva-detail-view';
  detail.setAttribute('aria-hidden','true');
  detail.innerHTML=`
    <button type="button" class="client-detail-back ceva-back">← Clientes</button>
    <div class="client-detail-head">
      <span class="client-detail-logo client-detail-logo-image"><img src="${CEVA_PROFILE.logo}" alt="Logo ${CEVA_PROFILE.displayName}"></span>
      <div>
        <span class="clients-kicker">Processo por cliente</span>
        <h2>${CEVA_PROFILE.name}</h2>
        <p>${CEVA_PROFILE.description}</p>
      </div>
    </div>
    <div class="ceva-mode-note"><b>DOCUMENTOS PDF</b><span>Envie um ou vários PDFs do processo. A leitura da CEVA identifica os dados pelo conteúdo real dos documentos e mantém a lógica isolada dos outros clientes.</span></div>
    <div class="ceva-upload-grid">
      <label class="client-upload-card ceva-pdf-card">
        <input type="file" accept="application/pdf,.pdf" data-ceva-file="pdfs" multiple hidden>
        <button type="button" class="client-file-clear" data-ceva-clear aria-label="Remover PDFs">×</button>
        <span class="client-upload-icon">▤</span>
        <strong>DOCUMENTOS PDF</strong>
        <small>Selecione um ou vários PDFs</small>
        <em>clique para selecionar</em>
      </label>
    </div>
    <div class="client-mode-status ceva-mode-status" aria-live="polite">Selecione os PDFs do processo CEVA.</div>
    <button type="button" class="client-analyze-button ceva-analyze-button" disabled>Analisar processo CEVA</button>
  `;
  content.appendChild(detail);

  const report=document.createElement('div');
  report.className='client-report-view ceva-report-view';
  report.setAttribute('aria-hidden','true');
  content.appendChild(report);

  const pdfInput=detail.querySelector<HTMLInputElement>('[data-ceva-file="pdfs"]')!;
  const status=detail.querySelector<HTMLElement>('.ceva-mode-status')!;
  const analyzeButton=detail.querySelector<HTMLButtonElement>('.ceva-analyze-button')!;
  const upload=detail.querySelector<HTMLElement>('.ceva-pdf-card')!;
  const clear=detail.querySelector<HTMLButtonElement>('[data-ceva-clear]')!;

  const refresh=()=>{
    const files=Array.from(pdfInput.files||[]);
    upload.classList.toggle('selected',files.length>0);
    clear.hidden=files.length===0;
    const em=upload.querySelector<HTMLElement>('em');
    if(em)em.textContent=files.length===0?'clique para selecionar':files.length===1?files[0].name:`${files.length} PDFs selecionados`;
    status.textContent=files.length===0?'Selecione os PDFs do processo CEVA.':files.length===1?`PDF selecionado: ${files[0].name}`:`${files.length} PDFs selecionados para a CEVA.`;
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

  const showReport=(analysis:CevaAnalysisSnapshot)=>{
    const rows=analysis.fields.map(field=>`
      <div class="client-report-row">
        <div class="client-report-field"><b>${escapeHtml(field.label)}</b><span>${escapeHtml(field.source)}</span></div>
        <div class="client-report-value">${escapeHtml(field.value)}</div>
        <div class="client-report-confidence">${escapeHtml(field.confidence)}</div>
      </div>`).join('');

    report.innerHTML=`
      <div class="client-report-toolbar">
        <button type="button" class="client-report-back ceva-report-back">← CEVA</button>
        <button type="button" class="client-report-copy ceva-report-copy">Copiar relatório</button>
      </div>
      <div class="client-report-head">
        <span class="client-report-logo"><img src="${CEVA_PROFILE.logo}" alt="Logo ${CEVA_PROFILE.displayName}"></span>
        <div><span class="clients-kicker">Relatório por cliente</span><h2>Relatório CEVA</h2><p><b>Cliente do relatório: CEVA</b> · ${escapeHtml(analysis.summary)}</p></div>
      </div>
      <div class="client-report-metrics">
        <div><span>Cliente</span><b>CEVA</b></div>
        <div><span>Operação</span><b>${escapeHtml(analysis.processType)}</b></div>
        <div><span>Campos</span><b>${analysis.found}/${analysis.total}</b></div>
      </div>
      <div class="client-report-table">${rows}</div>
      <button type="button" class="client-report-new ceva-report-new">Nova análise CEVA</button>
    `;

    hideOtherViews();panel.classList.add('report-mode');report.classList.add('active');report.setAttribute('aria-hidden','false');report.scrollTop=0;
    report.querySelector('.ceva-report-back')?.addEventListener('click',showDetail);
    report.querySelector('.ceva-report-new')?.addEventListener('click',()=>{pdfInput.value='';showDetail()});
    report.querySelector('.ceva-report-copy')?.addEventListener('click',()=>{
      const text=['Cliente do relatório: CEVA',`Operação: ${analysis.processType}`,'',...analysis.fields.map(f=>`${f.label}: ${f.value}\nFonte: ${f.source}`)].join('\n');
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
      analyzeButton.textContent='Analisando processo CEVA...';
      status.textContent='Lendo e cruzando os PDFs da CEVA...';
      const analysis=await runCevaAnalysis(files);
      showReport(analysis);
    }catch(error){
      status.textContent=error instanceof Error?error.message:'Não foi possível concluir a análise CEVA.';
    }finally{
      analyzeButton.textContent='Analisar processo CEVA';
      refresh();
    }
  });

  card.addEventListener('click',showDetail);
  detail.querySelector('.ceva-back')?.addEventListener('click',showList);
  document.querySelector('.clients-tab')?.addEventListener('click',()=>{detail.classList.remove('active');report.classList.remove('active')});
  document.querySelector('.clients-back-tab')?.addEventListener('click',()=>{detail.classList.remove('active');report.classList.remove('active')});
  refresh();
  return true;
}

if(!bindCeva()){
  const startupObserver=new MutationObserver(()=>{if(bindCeva())startupObserver.disconnect()});
  startupObserver.observe(document.documentElement,{childList:true,subtree:true});
}
