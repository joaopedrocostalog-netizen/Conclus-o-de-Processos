import { XCMG_PROFILE } from './clients/xcmg';

export {};

function bindXcmg(){
  const panel=document.querySelector<HTMLElement>('.clients-panel');
  const content=panel?.querySelector<HTMLElement>('.clients-content-panel');
  const list=panel?.querySelector<HTMLElement>('.clients-list-view');
  const grid=list?.querySelector<HTMLElement>('.clients-grid');
  if(!panel||!content||!list||!grid)return false;
  if(grid.querySelector('.client-card-xcmg'))return true;

  const card=document.createElement('button');
  card.type='button';
  card.className='client-card client-card-xcmg';
  card.setAttribute('aria-label',`Abrir cliente ${XCMG_PROFILE.name}`);
  card.innerHTML=`
    <span class="client-logo-image"><img src="${XCMG_PROFILE.logo}" alt="Logo ${XCMG_PROFILE.displayName}"></span>
    <strong>${XCMG_PROFILE.name}</strong>
    <small>Lógica própria por cliente</small>
    <span class="client-capabilities" aria-label="Formatos aceitos"><span>NF</span><span>ZIP</span></span>
  `;
  grid.appendChild(card);

  const detail=document.createElement('div');
  detail.className='client-detail-view xcmg-detail-view';
  detail.setAttribute('aria-hidden','true');
  detail.innerHTML=`
    <button type="button" class="client-detail-back xcmg-back">← Clientes</button>
    <div class="client-detail-head">
      <span class="client-detail-logo client-detail-logo-image"><img src="${XCMG_PROFILE.logo}" alt="Logo ${XCMG_PROFILE.displayName}"></span>
      <div>
        <span class="clients-kicker">Processo por cliente</span>
        <h2>${XCMG_PROFILE.name}</h2>
        <p>${XCMG_PROFILE.description}</p>
      </div>
    </div>
    <div class="xcmg-mode-note"><b>Escolha um modo de envio</b><span>Envie uma NF Fiscal em PDF ou um pacote .ZIP. Os dois modos não são usados ao mesmo tempo.</span></div>
    <div class="xcmg-upload-grid">
      <label class="client-upload-card xcmg-nf-card">
        <input type="file" accept="application/pdf,.pdf" data-xcmg-file="nf" hidden>
        <button type="button" class="client-file-clear" data-xcmg-clear="nf" aria-label="Remover NF Fiscal">×</button>
        <span class="client-upload-icon">▤</span>
        <strong>NF FISCAL</strong>
        <small>Selecione a NF em PDF</small>
        <em>clique para selecionar</em>
      </label>
      <label class="client-upload-card xcmg-zip-card">
        <input type="file" accept=".zip,application/zip" data-xcmg-file="zip" hidden>
        <button type="button" class="client-file-clear" data-xcmg-clear="zip" aria-label="Remover pacote ZIP">×</button>
        <span class="client-upload-icon">▣</span>
        <strong>PACOTE .ZIP</strong>
        <small>Documentos do processo dentro do ZIP</small>
        <em>clique para selecionar</em>
      </label>
    </div>
    <div class="client-mode-status xcmg-mode-status" aria-live="polite">Selecione uma NF Fiscal ou utilize um pacote .ZIP.</div>
    <button type="button" class="client-analyze-button xcmg-analyze-button" disabled>Analisar processo XCMG</button>
  `;
  content.appendChild(detail);

  const nfInput=detail.querySelector<HTMLInputElement>('[data-xcmg-file="nf"]')!;
  const zipInput=detail.querySelector<HTMLInputElement>('[data-xcmg-file="zip"]')!;
  const status=detail.querySelector<HTMLElement>('.xcmg-mode-status')!;
  const analyzeButton=detail.querySelector<HTMLButtonElement>('.xcmg-analyze-button')!;

  const setCard=(input:HTMLInputElement)=>{
    const upload=input.closest<HTMLElement>('.client-upload-card');
    if(!upload)return;
    const file=input.files?.[0]||null;
    upload.classList.toggle('selected',Boolean(file));
    const em=upload.querySelector<HTMLElement>('em');if(em)em.textContent=file?.name||'clique para selecionar';
    const clear=upload.querySelector<HTMLButtonElement>('.client-file-clear');if(clear)clear.hidden=!file;
  };
  const refresh=()=>{
    const nf=nfInput.files?.[0]||null,zip=zipInput.files?.[0]||null;
    setCard(nfInput);setCard(zipInput);
    if(zip)status.textContent=`ZIP selecionado: ${zip.name}`;
    else if(nf)status.textContent=`NF selecionada: ${nf.name}`;
    else status.textContent='Selecione uma NF Fiscal ou utilize um pacote .ZIP.';
    analyzeButton.disabled=!(nf||zip);
  };

  nfInput.addEventListener('change',()=>{if(nfInput.files?.length)zipInput.value='';refresh()});
  zipInput.addEventListener('change',()=>{if(zipInput.files?.length)nfInput.value='';refresh()});
  detail.querySelectorAll<HTMLButtonElement>('[data-xcmg-clear]').forEach(button=>{
    button.hidden=true;
    button.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();
      const input=detail.querySelector<HTMLInputElement>(`[data-xcmg-file="${button.dataset.xcmgClear}"]`);
      if(input)input.value='';refresh();
    });
  });

  const hideOtherViews=()=>{
    panel.querySelectorAll<HTMLElement>('.clients-list-view,.client-detail-view,.client-report-view').forEach(view=>{
      view.classList.remove('active','leaving');view.setAttribute('aria-hidden','true');
    });
    panel.classList.remove('report-mode');
  };
  const showList=()=>{hideOtherViews();list.classList.add('active');list.setAttribute('aria-hidden','false')};
  const showDetail=()=>{hideOtherViews();detail.classList.add('active');detail.setAttribute('aria-hidden','false');detail.scrollTop=0;refresh()};

  analyzeButton.addEventListener('click',()=>{
    status.textContent='Arquivos XCMG carregados. A base de extração será configurada separadamente para este cliente.';
  });

  card.addEventListener('click',showDetail);
  detail.querySelector('.xcmg-back')?.addEventListener('click',showList);
  document.querySelector('.clients-tab')?.addEventListener('click',()=>detail.classList.remove('active'));
  document.querySelector('.clients-back-tab')?.addEventListener('click',()=>detail.classList.remove('active'));
  refresh();
  return true;
}

if(!bindXcmg()){
  const startupObserver=new MutationObserver(()=>{if(bindXcmg())startupObserver.disconnect()});
  startupObserver.observe(document.documentElement,{childList:true,subtree:true});
}
