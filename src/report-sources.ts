const enhanceReportSources = (root: ParentNode = document) => {
  root.querySelectorAll<HTMLElement>('.client-report-row').forEach((row, index) => {
    if (row.dataset.sourceEnhanced === 'true') return;

    const field = row.querySelector<HTMLElement>('.client-report-field');
    const source = field?.querySelector<HTMLElement>('span');
    const confidence = row.querySelector<HTMLElement>('.client-report-confidence');
    if (!field || !source || !confidence) return;

    const sourceText = source.textContent?.trim() || 'Fonte não informada.';
    source.remove();

    const statusText = document.createElement('span');
    statusText.className = 'client-report-confidence-text';
    while (confidence.firstChild) statusText.appendChild(confidence.firstChild);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'client-report-source-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Mostrar fonte desta informação');
    toggle.innerHTML = '<span aria-hidden="true">⌄</span>';

    const detail = document.createElement('div');
    detail.className = 'client-report-source-detail';
    detail.id = `client-report-source-${Date.now()}-${index}`;
    detail.hidden = true;
    detail.innerHTML = `<b>Fonte da informação</b><span>${sourceText.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char] || char))}</span>`;

    toggle.setAttribute('aria-controls', detail.id);
    confidence.appendChild(statusText);
    confidence.appendChild(toggle);
    row.appendChild(detail);

    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.setAttribute('aria-label', open ? 'Mostrar fonte desta informação' : 'Ocultar fonte desta informação');
      detail.hidden = open;
      row.classList.toggle('source-open', !open);
    });

    row.dataset.sourceEnhanced = 'true';
  });
};

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches('.client-report-row') || node.querySelector('.client-report-row')) {
        enhanceReportSources(node.matches('.client-report-row') ? node.parentNode || document : node);
      }
    }
  }
});

const start = () => {
  enhanceReportSources();
  observer.observe(document.documentElement, { childList: true, subtree: true });
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
