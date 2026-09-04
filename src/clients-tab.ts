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

  clientsPanel.appendChild(clientsBrand);
  clientsPanel.appendChild(clientsContent);

  openButton.addEventListener('click', () => {
    if (app.classList.contains('clients-view-open')) return;
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
