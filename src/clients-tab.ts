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
      <button type="button" class="client-card client-card-template" aria-label="Abrir cliente modelo">
        <span class="client-logo-placeholder">+</span>
        <strong>Cliente</strong>
        <small>Aguardando nome e logo</small>
      </button>
    </div>
  `;

  const detailView = document.createElement('div');
  detailView.className = 'client-detail-view';
  detailView.setAttribute('aria-hidden', 'true');
  detailView.innerHTML = `
    <button type="button" class="client-detail-back">← Clientes</button>
    <div class="client-detail-head">
      <span class="client-detail-logo">+</span>
      <div>
        <span class="clients-kicker">Processo por cliente</span>
        <h2>Cliente</h2>
        <p>Os padrões de extração serão configurados individualmente para este cliente.</p>
      </div>
    </div>
    <div class="client-required-note"><b>DOC COMPLETO + NF FISCAL</b><span>Os dois PDFs são obrigatórios quando esse modo for utilizado.</span></div>
    <div class="client-upload-grid">
      <label class="client-upload-card">
        <input type="file" accept="application/pdf,.pdf" data-client-file="doc" hidden>
        <span class="client-upload-icon">▤</span>
        <strong>DOC COMPLETO</strong>
        <small class="client-required">Obrigatório</small>
        <em>clique para selecionar</em>
      </label>
      <label class="client-upload-card">
        <input type="file" accept="application/pdf,.pdf" data-client-file="nf" hidden>
        <span class="client-upload-icon">▤</span>
        <strong>NF FISCAL</strong>
        <small class="client-required">Obrigatório</small>
        <em>clique para selecionar</em>
      </label>
    </div>
    <div class="client-mode-divider"><span>ou</span></div>
    <label class="client-upload-card client-upload-zip">
      <input type="file" accept=".zip,application/zip" data-client-file="zip" hidden>
      <span class="client-upload-icon">▣</span>
      <strong>PACOTE .ZIP</strong>
      <small>PDFs do processo dentro do ZIP</small>
      <em>clique para selecionar</em>
    </label>
    <div class="client-mode-status" aria-live="polite">Selecione DOC COMPLETO + NF FISCAL, ou utilize um pacote .ZIP.</div>
  `;

  clientsContent.appendChild(listView);
  clientsContent.appendChild(detailView);
  clientsPanel.appendChild(clientsBrand);
  clientsPanel.appendChild(clientsContent);

  const showClientList = () => {
    detailView.classList.remove('active');
    detailView.setAttribute('aria-hidden', 'true');
    listView.classList.remove('leaving');
    listView.classList.add('active');
  };

  const showClientDetail = () => {
    listView.classList.add('leaving');
    window.setTimeout(() => {
      listView.classList.remove('active');
      detailView.classList.add('active');
      detailView.setAttribute('aria-hidden', 'false');
    }, 150);
  };

  listView.classList.add('active');
  listView.querySelector('.client-card')?.addEventListener('click', showClientDetail);
  detailView.querySelector('.client-detail-back')?.addEventListener('click', showClientList);

  const fileInputs = [...detailView.querySelectorAll<HTMLInputElement>('input[type="file"]')];
  const refreshClientFiles = () => {
    const doc = detailView.querySelector<HTMLInputElement>('[data-client-file="doc"]')?.files?.[0] ?? null;
    const nf = detailView.querySelector<HTMLInputElement>('[data-client-file="nf"]')?.files?.[0] ?? null;
    const zip = detailView.querySelector<HTMLInputElement>('[data-client-file="zip"]')?.files?.[0] ?? null;
    const status = detailView.querySelector<HTMLElement>('.client-mode-status');
    if (!status) return;
    if (zip) status.textContent = `ZIP selecionado: ${zip.name}`;
    else if (doc && nf) status.textContent = 'DOC COMPLETO + NF FISCAL selecionados. Os dois arquivos obrigatórios estão prontos.';
    else if (doc || nf) status.textContent = 'Falta selecionar o segundo PDF obrigatório: DOC COMPLETO + NF FISCAL precisam estar juntos.';
    else status.textContent = 'Selecione DOC COMPLETO + NF FISCAL, ou utilize um pacote .ZIP.';

    fileInputs.forEach(input => {
      const card = input.closest<HTMLElement>('.client-upload-card');
      if (!card) return;
      card.classList.toggle('selected', Boolean(input.files?.[0]));
      const em = card.querySelector('em');
      if (em) em.textContent = input.files?.[0]?.name || 'clique para selecionar';
    });
  };
  fileInputs.forEach(input => input.addEventListener('change', refreshClientFiles));

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
    showClientList();
    app.classList.add('clients-returning');
    app.classList.remove('clients-view-open');
    clientsPanel.classList.remove('active');
    window.setTimeout(() => {
      clientsPanel.setAttribute('aria-hidden', 'true');
      app.classList.remove('clients-returning');
    }, 380);
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
