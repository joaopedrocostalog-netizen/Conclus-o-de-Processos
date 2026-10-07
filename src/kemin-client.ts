import { KEMIN_PROFILE } from './clients/kemin';

export {};

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
    <div class="kemin-mode-note"><b>DOCUMENTOS PDF</b><span>Envie um ou vários PDFs do processo. A leitura da KEMIN ficará isolada das regras dos outros clientes.</span></div>
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

  pdfInput.addEventListener('change',refresh);
  clear.hidden=true;
  clear.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();pdfInput.value='';refresh()});
  analyzeButton.addEventListener('click',()=>{
    const files=Array.from(pdfInput.files||[]);
    if(!files.length){refresh();return;}
    status.textContent='PDFs KEMIN carregados. A lógica de extração será configurada exclusivamente para este cliente.';
  });

  card.addEventListener('click',showDetail);
  detail.querySelector('.kemin-back')?.addEventListener('click',showList);
  document.querySelector('.clients-tab')?.addEventListener('click',()=>detail.classList.remove('active'));
  document.querySelector('.clients-back-tab')?.addEventListener('click',()=>detail.classList.remove('active'));
  refresh();
  return true;
}

if(!bindKemin()){
  const startupObserver=new MutationObserver(()=>{if(bindKemin())startupObserver.disconnect()});
  startupObserver.observe(document.documentElement,{childList:true,subtree:true});
}
