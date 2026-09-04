import { GLOVIS_PROFILE } from './clients/glovis';
import { resetValidatedBase, runValidatedBase, type ClientAnalysisSnapshot } from './clients/validated-base';

const escapeHtml=(value:string)=>value.replace(/[&<>'"]/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
}[char]||char));

const ensureClientsTab = () => {
  const app = document.querySelector<HTMLElement>('.app');
  const main = app?.querySelector<HTMLElement>('main');
  const hero = main?.querySelector<HTMLElement>('.hero');
  const header = app?.querySelector<HTMLElement>(':scope > header');
  if (!app || !main || !hero || !header) return;
  if (app.querySelector('.clients-tab')) return;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'clients-tab';
  openButton.textContent = 'Clientes';

  const clientsPanel = document.createElement('section');
  clientsPanel.className = 'clients-panel';
  clientsPanel.setAttribute('aria-hidden', 'true');

  const clientsBrand = header.cloneNode(true) as HTMLElement;
  clientsBrand.classList.add('clients-brand-panel');

  const clientsContent = document.createElement('div');
  clientsContent.className = 'clients-content-panel';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'clients-back-tab';
  backButton.textContent = 'Voltar';
  clientsContent.appendChild(backButton);

  const listView = document.createElement('div');
  listView.className = 'clients-list-view';
  listView.innerHTML = `
    <div class="clients-list-head">
      <span class="clients-kicker">Clientes</span>
      <h2>Selecione um cliente</h2>
      <p>Cada cliente terá regras próprias de leitura e conferência dos documentos.</p>
    </div>
    <div class="clients-grid">
      <button type="button" class="client-card client-card-glovis" aria-label="Abrir cliente ${GLOVIS_PROFILE.name}">
        <span class="client-logo-image"><img src="${GLOVIS_PROFILE.logo}" alt="Logo ${GLOVIS_PROFILE.displayName}"></span>
        <strong>${GLOVIS_PROFILE.name}</strong>
        <small>Base de leitura validada</small>
      </button>
    </div>
  `;

  const detailView = document.createElement('div');
  detailView.className = 'client-detail-view';
  detailView.setAttribute('aria-hidden', 'true');
  detailView.innerHTML = `
    <button type="button" class="client-detail-back">← Clientes</button>
    <div class="client-detail-head">
      <span class="client-detail-logo client-detail-logo-image"><img src="${GLOVIS_PROFILE.logo}" alt="Logo ${GLOVIS_PROFILE.displayName}"></span>
      <div>
        <span class="clients-kicker">Processo por cliente</span>
        <h2>${GLOVIS_PROFILE.name}</h2>
        <p>Este cliente utiliza a mesma base de extração e conferência já validada no sistema principal.</p>
      </div>
    </div>
    <div class="client-required-note"><b>DOC COMPLETO + NF FISCAL</b><span>Os dois PDFs são obrigatórios quando esse modo for utilizado.</span></div>
    <div class="client-upload-grid">
      <label class="client-upload-card">
        <input type="file" accept="application/pdf,.pdf" data-client-file="doc" hidden>
        <button type="button" class="client-file-clear" data-clear-file="doc" aria-label="Remover DOC COMPLETO">×</button>
        <span class="client-upload-icon">▤</span>
        <strong>DOC COMPLETO</strong>
        <small class="client-required">Obrigatório</small>
        <em>clique para selecionar</em>
      </label>
      <label class="client-upload-card">
        <input type="file" accept="application/pdf,.pdf" data-client-file="nf" hidden>
        <button type="button" class="client-file-clear" data-clear-file="nf" aria-label="Remover NF FISCAL">×</button>
        <span class="client-upload-icon">▤</span>
        <strong>NF FISCAL</strong>
        <small class="client-required">Obrigatório</small>
        <em>clique para selecionar</em>
      </label>
    </div>
    <div class="client-mode-divider"><span>ou</span></div>
    <label class="client-upload-card client-upload-zip">
      <input type="file" accept=".zip,application/zip" data-client-file="zip" hidden>
      <button type="button" class="client-file-clear" data-clear-file="zip" aria-label="Remover pacote ZIP">×</button>
      <span class="client-upload-icon">▣</span>
      <strong>PACOTE .ZIP</strong>
      <small>PDFs do processo dentro do ZIP</small>
      <em>clique para selecionar</em>
    </label>
    <div class="client-mode-status" aria-live="polite">Selecione DOC COMPLETO + NF FISCAL, ou utilize um pacote .ZIP.</div>
    <button type="button" class="client-analyze-button" disabled>Analisar processo GLOVIS</button>
  `;

  const reportView=document.createElement('div');
  reportView.className='client-report-view';
  reportView.setAttribute('aria-hidden','true');

  clientsContent.appendChild(listView);
  clientsContent.appendChild(detailView);
  clientsContent.appendChild(reportView);
  clientsPanel.appendChild(clientsBrand);
  clientsPanel.appendChild(clientsContent);

  const hideViews=()=>{
    listView.classList.remove('active','leaving');
    detailView.classList.remove('active');
    reportView.classList.remove('active');
    listView.setAttribute('aria-hidden','true');
    detailView.setAttribute('aria-hidden','true');
    reportView.setAttribute('aria-hidden','true');
  };

  const showClientList = () => {
    hideViews();
    listView.classList.add('active');
    listView.setAttribute('aria-hidden','false');
  };

  const showClientDetail = () => {
    listView.classList.add('leaving');
    window.setTimeout(() => {
      hideViews();
      detailView.classList.add('active');
      detailView.setAttribute('aria-hidden', 'false');
      detailView.scrollTop=0;
    }, 150);
  };

  const clearClientFiles=()=>{
    detailView.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach(input=>{input.value=''});
    refreshClientFiles();
  };

  const showReport=(analysis:ClientAnalysisSnapshot)=>{
    const fields=analysis.fields.map(field=>`
      <div class="client-report-row">
        <div class="client-report-field"><b>${escapeHtml(field.label)}</b><span>${escapeHtml(field.source)}</span></div>
        <div class="client-report-value">${escapeHtml(field.value)}</div>
        <div class="client-report-confidence">${escapeHtml(field.confidence)}</div>
      </div>`).join('');
    reportView.innerHTML=`
      <div class="client-report-toolbar">
        <button type="button" class="client-report-back">← GLOVIS</button>
        <button type="button" class="client-report-copy">Copiar relatório</button>
      </div>
      <div class="client-report-head">
        <span class="client-report-logo"><img src="${GLOVIS_PROFILE.logo}" alt="Logo ${GLOVIS_PROFILE.displayName}"></span>
        <div>
          <span class="clients-kicker">Relatório por cliente</span>
          <h2>Relatório ${GLOVIS_PROFILE.name}</h2>
          <p><b>Cliente do relatório: ${GLOVIS_PROFILE.name}</b> · ${escapeHtml(analysis.summary||'Análise concluída')}</p>
        </div>
      </div>
      <div class="client-report-metrics">
        <div><span>Cliente</span><b>${GLOVIS_PROFILE.name}</b></div>
        <div><span>Operação</span><b>${escapeHtml(analysis.processType)}</b></div>
        <div><span>Campos</span><b>${analysis.found}/${analysis.total}</b></div>
      </div>
      <div class="client-report-table">${fields}</div>
      <button type="button" class="client-report-new">Nova análise ${GLOVIS_PROFILE.name}</button>
    `;
    hideViews();
    reportView.classList.add('active');
    reportView.setAttribute('aria-hidden','false');
    reportView.scrollTop=0;

    reportView.querySelector('.client-report-back')?.addEventListener('click',()=>{
      hideViews();
      detailView.classList.add('active');
      detailView.setAttribute('aria-hidden','false');
      detailView.scrollTop=0;
    });
    reportView.querySelector('.client-report-new')?.addEventListener('click',async()=>{
      await resetValidatedBase();
      clearClientFiles();
      hideViews();
      detailView.classList.add('active');
      detailView.setAttribute('aria-hidden','false');
      detailView.scrollTop=0;
    });
    reportView.querySelector('.client-report-copy')?.addEventListener('click',()=>{
      const text=[
        `Cliente do relatório: ${GLOVIS_PROFILE.name}`,
        `Operação: ${analysis.processType}`,
        '',
        ...analysis.fields.map(field=>`${field.label}: ${field.value}`)
      ].join('\n');
      void navigator.clipboard?.writeText(text);
    });
  };

  const closeClientsPanel = async() => {
    await resetValidatedBase();
    showClientList();
    app.classList.add('clients-returning');
    app.classList.remove('clients-view-open');
    clientsPanel.classList.remove('active');
    window.setTimeout(() => {
      clientsPanel.setAttribute('aria-hidden', 'true');
      app.classList.remove('clients-returning');
    }, 380);
  };

  listView.classList.add('active');
  listView.setAttribute('aria-hidden','false');
  listView.querySelector('.client-card-glovis')?.addEventListener('click', showClientDetail);
  detailView.querySelector('.client-detail-back')?.addEventListener('click', showClientList);

  const fileInputs = [...detailView.querySelectorAll<HTMLInputElement>('input[type="file"]')];
  const analyzeButton = detailView.querySelector<HTMLButtonElement>('.client-analyze-button');
  const getFiles = () => ({
    doc: detailView.querySelector<HTMLInputElement>('[data-client-file="doc"]')?.files?.[0] ?? null,
    nf: detailView.querySelector<HTMLInputElement>('[data-client-file="nf"]')?.files?.[0] ?? null,
    zip: detailView.querySelector<HTMLInputElement>('[data-client-file="zip"]')?.files?.[0] ?? null
  });

  function refreshClientFiles(){
    const {doc,nf,zip}=getFiles();
    const status = detailView.querySelector<HTMLElement>('.client-mode-status');
    if (!status) return;
    if (zip) status.textContent = `ZIP selecionado: ${zip.name}`;
    else if (doc && nf) status.textContent = 'DOC COMPLETO + NF FISCAL selecionados. Os dois arquivos obrigatórios estão prontos.';
    else if (doc || nf) status.textContent = 'Falta selecionar o segundo PDF obrigatório: DOC COMPLETO + NF FISCAL precisam estar juntos.';
    else status.textContent = 'Selecione DOC COMPLETO + NF FISCAL, ou utilize um pacote .ZIP.';

    if(analyzeButton)analyzeButton.disabled=!(zip||(doc&&nf));
    fileInputs.forEach(input => {
      const card = input.closest<HTMLElement>('.client-upload-card');
      if (!card) return;
      const selected=Boolean(input.files?.[0]);
      card.classList.toggle('selected', selected);
      const em = card.querySelector('em');
      if (em) em.textContent = input.files?.[0]?.name || 'clique para selecionar';
      const clear=card.querySelector<HTMLButtonElement>('.client-file-clear');
      if(clear)clear.hidden=!selected;
    });
  }

  fileInputs.forEach(input => input.addEventListener('change',()=>{
    if(input.files?.[0]){
      const kind=input.dataset.clientFile;
      if(kind==='zip'){
        fileInputs.filter(other=>other!==input&&other.dataset.clientFile!=='zip').forEach(other=>{other.value=''});
      }else{
        fileInputs.filter(other=>other.dataset.clientFile==='zip').forEach(other=>{other.value=''});
      }
    }
    refreshClientFiles();
  }));

  detailView.querySelectorAll<HTMLButtonElement>('.client-file-clear').forEach(button=>{
    button.hidden=true;
    button.addEventListener('click',event=>{
      event.preventDefault();
      event.stopPropagation();
      const kind=button.dataset.clearFile;
      const input=detailView.querySelector<HTMLInputElement>(`[data-client-file="${kind}"]`);
      if(input)input.value='';
      refreshClientFiles();
    });
  });

  analyzeButton?.addEventListener('click', async()=>{
    const files=getFiles();
    const status=detailView.querySelector<HTMLElement>('.client-mode-status');
    try{
      analyzeButton.disabled=true;
      analyzeButton.textContent='Analisando processo GLOVIS...';
      if(status)status.textContent='Lendo e cruzando os documentos da GLOVIS...';
      const analysis=await runValidatedBase(files);
      showReport(analysis);
    }catch(error){
      if(status)status.textContent=error instanceof Error?error.message:'Não foi possível iniciar a análise.';
      refreshClientFiles();
    }finally{
      analyzeButton.textContent='Analisar processo GLOVIS';
      refreshClientFiles();
    }
  });

  openButton.addEventListener('click', () => {
    if (app.classList.contains('clients-view-open')) return;
    showClientList();
    clientsPanel.setAttribute('aria-hidden', 'false');
    app.classList.add('clients-switching');
    requestAnimationFrame(() => {
      clientsPanel.classList.add('active');
      app.classList.add('clients-view-open');
    });
    window.setTimeout(() => app.classList.remove('clients-switching'), 380);
  });

  backButton.addEventListener('click', () => {
    if (!app.classList.contains('clients-view-open')) return;
    void closeClientsPanel();
  });

  main.appendChild(openButton);
  app.appendChild(clientsPanel);
};

const observer = new MutationObserver(() => ensureClientsTab());
observer.observe(document.documentElement, { childList: true, subtree: true });

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureClientsTab);
} else {
  ensureClientsTab();
}
