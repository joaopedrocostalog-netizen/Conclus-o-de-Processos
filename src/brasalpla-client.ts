import { BRASALPLA_PROFILE } from './clients/brasalpla';
export {};

function bindBrasalpla(){
  const panel=document.querySelector<HTMLElement>('.clients-panel');
  const content=panel?.querySelector<HTMLElement>('.clients-content-panel');
  const list=panel?.querySelector<HTMLElement>('.clients-list-view');
  const grid=list?.querySelector<HTMLElement>('.clients-grid');
  if(!panel||!content||!list||!grid)return false;
  if(grid.querySelector('.client-card-brasalpla'))return true;

  const card=document.createElement('button');
  card.type='button';
  card.className='client-card client-card-brasalpla';
  card.setAttribute('aria-label','Abrir cliente BRASALPLA');
  card.innerHTML=`
    <span class="client-logo-image"><img src="${BRASALPLA_PROFILE.logo}" alt="Logo BRASALPLA"></span>
    <strong>BRASALPLA</strong>
    <span class="client-capabilities" aria-label="Formatos aceitos"><span>PDFs</span></span>
  `;
  grid.appendChild(card);

  const detail=document.createElement('div');
  detail.className='client-detail-view brasalpla-detail-view';
  detail.setAttribute('aria-hidden','true');
  detail.innerHTML=`
    <button type="button" class="client-detail-back brasalpla-back">← Clientes</button>
    <div class="client-detail-head">
      <span class="client-detail-logo client-detail-logo-image"><img src="${BRASALPLA_PROFILE.logo}" alt="Logo BRASALPLA"></span>
      <div><span class="clients-kicker">Processo por cliente</span><h2>BRASALPLA</h2><p>${BRASALPLA_PROFILE.description}</p></div>
    </div>
    <div class="brasalpla-mode-note">Envie um ou vários PDFs do processo BRASALPLA. Os campos de extração serão configurados exclusivamente para este cliente.</div>
    <div class="brasalpla-upload-grid">
      <label class="client-upload-card brasalpla-pdf-card">
        <input type="file" accept="application/pdf,.pdf" data-brasalpla-file="pdfs" multiple hidden>
        <button type="button" class="client-file-clear brasalpla-clear" aria-label="Remover PDFs" hidden>×</button>
        <span class="client-upload-icon">▤</span>
        <strong>DOCUMENTOS PDF</strong>
        <small>Selecione um ou vários PDFs</small>
        <em>clique para selecionar</em>
      </label>
    </div>
    <div class="client-mode-status brasalpla-mode-status" aria-live="polite">Selecione os PDFs do processo BRASALPLA.</div>
    <button type="button" class="client-analyze-button brasalpla-analyze-button" disabled>Analisar processo BRASALPLA</button>
  `;
  content.appendChild(detail);
  const pdfInput=detail.querySelector<HTMLInputElement>('[data-brasalpla-file="pdfs"]')!;
  const upload=detail.querySelector<HTMLElement>('.brasalpla-pdf-card')!;
  const clear=detail.querySelector<HTMLButtonElement>('.brasalpla-clear')!;
  const status=detail.querySelector<HTMLElement>('.brasalpla-mode-status')!;
  const analyze=detail.querySelector<HTMLButtonElement>('.brasalpla-analyze-button')!;
  const refresh=()=>{
    const files=Array.from(pdfInput.files||[]);
    upload.classList.toggle('selected',files.length>0);
    clear.hidden=!files.length;
    analyze.disabled=!files.length;
    const display=upload.querySelector<HTMLElement>('em');
    if(display)display.textContent=!files.length?'clique para selecionar':files.length===1?files[0].name:`${files.length} PDFs selecionados`;
    status.textContent=!files.length?'Selecione os PDFs do processo BRASALPLA.':files.length===1?`PDF selecionado: ${files[0].name}`:`${files.length} PDFs selecionados.`;
  };
  pdfInput.addEventListener('change',refresh);
  clear.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();pdfInput.value='';refresh()});
  analyze.addEventListener('click',()=>{
    status.textContent='PDFs selecionados. A extração ficará disponível após definirmos os campos do relatório BRASALPLA.';
  });
  refresh();
  const hideViews=()=>{
    panel.querySelectorAll<HTMLElement>('.clients-list-view,.client-detail-view,.client-report-view').forEach(view=>{
      view.classList.remove('active','leaving');view.setAttribute('aria-hidden','true');
    });
    panel.classList.remove('report-mode');
  };
  const showList=()=>{hideViews();list.classList.add('active');list.setAttribute('aria-hidden','false')};
  const showDetail=()=>{hideViews();detail.classList.add('active');detail.setAttribute('aria-hidden','false');refresh()};
  card.addEventListener('click',showDetail);
  detail.querySelector('.brasalpla-back')?.addEventListener('click',showList);
  document.querySelector('.clients-tab')?.addEventListener('click',()=>detail.classList.remove('active'));
  document.querySelector('.clients-back-tab')?.addEventListener('click',()=>detail.classList.remove('active'));
  return true;
}
if(!bindBrasalpla()){
  const observer=new MutationObserver(()=>{if(bindBrasalpla())observer.disconnect()});
  observer.observe(document.documentElement,{childList:true,subtree:true});
}
