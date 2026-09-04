const ensureClientsTab = () => {
  const main = document.querySelector('main');
  const hero = main?.querySelector<HTMLElement>('.hero');
  if (!main || !hero) return;
  if (main.querySelector('.clients-tab')) return;

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
    hero.classList.add('card-view-leave');
    window.setTimeout(() => {
      hero.style.display = 'none';
      clientsPanel.classList.add('active');
      clientsPanel.setAttribute('aria-hidden', 'false');
      main.classList.add('clients-view-open');
    }, 220);
  });

  backButton.addEventListener('click', () => {
    clientsPanel.classList.remove('active');
    clientsPanel.setAttribute('aria-hidden', 'true');
    main.classList.remove('clients-view-open');
    window.setTimeout(() => {
      hero.style.display = '';
      hero.classList.remove('card-view-leave');
      hero.classList.add('card-view-enter');
      window.setTimeout(() => hero.classList.remove('card-view-enter'), 320);
    }, 180);
  });

  main.appendChild(openButton);
  main.appendChild(clientsPanel);
};

const observer = new MutationObserver(() => ensureClientsTab());
observer.observe(document.documentElement, { childList: true, subtree: true });

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureClientsTab);
} else {
  ensureClientsTab();
}
