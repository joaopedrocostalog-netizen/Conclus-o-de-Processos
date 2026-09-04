const ensureClientsTab = () => {
  const app = document.querySelector<HTMLElement>('.app');
  const main = app?.querySelector<HTMLElement>('main');
  const hero = main?.querySelector<HTMLElement>('.hero');
  if (!app || !main || !hero) return;
  if (app.querySelector('.clients-tab')) return;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'clients-tab';
  openButton.textContent = 'Clientes';

  const clientsPanel = document.createElement('section');
  clientsPanel.className = 'clients-panel';
  clientsPanel.setAttribute('aria-hidden', 'true');

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'clients-back-tab';
  backButton.textContent = 'Voltar';
  clientsPanel.appendChild(backButton);

  openButton.addEventListener('click', () => {
    app.classList.add('clients-switching');
    window.setTimeout(() => {
      clientsPanel.classList.add('active');
      clientsPanel.setAttribute('aria-hidden', 'false');
      app.classList.add('clients-view-open');
      app.classList.remove('clients-switching');
    }, 180);
  });

  backButton.addEventListener('click', () => {
    clientsPanel.classList.remove('active');
    clientsPanel.setAttribute('aria-hidden', 'true');
    app.classList.remove('clients-view-open');
    app.classList.add('clients-returning');
    window.setTimeout(() => app.classList.remove('clients-returning'), 300);
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
