import { IGUASPORT_PROFILE } from './clients/iguasport';

export {};

function bindIguasport(){
  const panel=document.querySelector<HTMLElement>('.clients-panel');
  const content=panel?.querySelector<HTMLElement>('.clients-content-panel');
  const list=panel?.querySelector<HTMLElement>('.clients-list-view');
  const grid=list?.querySelector<HTMLElement>('.clients-grid');
  if(!panel||!content||!list||!grid)return false;
  if(grid.querySelector('.client-card-iguasport'))return true;

  const card=document.createElement('button');
  card.type='button';
  card.className='client-card client-card-iguasport';
  card.setAttribute('aria-label',`Abrir cliente ${IGUASPORT_PROFILE.name}`);
  card.innerHTML=`
    <span class="client-logo-image"><img src="${IGUASPORT_PROFILE.logo}" alt="Logo ${IGUASPORT_PROFILE.displayName}"></span>
    <strong>${IGUASPORT_PROFILE.name}</strong>
    <small>Lógica própria por cliente</small>
    <span class="client-capabilities" aria-label="Formatos aceitos"><span>Vários PDFs</span><span>ZIP</span></span>
  `;
  grid.appendChild(card);

  const detail=document.createElement('div');
  detail.className='client-detail-view iguasport-detail-view';
  detail.setAttribute('aria-hidden','true');
  detail.innerHTML=`
    <button type="button" class="client-detail-back iguasport-back">← Clientes</button>
    <div class="client-detail-head">
      <span class="client-detail-logo client-detail-logo-image"><img src="${IGUASPORT_PROFILE.logo}" alt="Logo ${IGUASPORT_PROFILE.displayName}"></span>
      <div>
        <span class="clients-kicker">Processo por cliente</span>
        <h2>${IGUASPORT_PROFILE.name}</h2>
        <p>${IGUASPORT_PROFILE.description}</p>
      </div>
    </div>
    <div class="iguasport-mode-note"><b>Escolha um modo de envio</b><span>Envie vários PDFs avulsos ou um único pacote .ZIP. Os dois modos não são usados ao mesmo tempo.</span></div>
    <div class="iguasport-upload-grid">
      <label class="client-upload-card iguasport-pdfs-card">
        <input type="file" accept="application/pdf,.pdf" multiple data-iguasport-file="pdfs" hidden>
        <button type="button" class="client-file-clear" data-iguasport-clear="pdfs" aria-label="Remover PDFs">×</button>
        <span class="client-upload-icon">▤</span>
        <strong>VÁRIOS PDFs</strong>
        <small>Selecione um ou mais arquivos PDF</small>
        <em>clique para selecionar</em>
      </label>
      <label class="client-upload-card iguasport-zip-card">
        <input type="file" accept=".zip,application/zip" data-iguasport-file="zip" hidden>
        <button type="button" class="client-file-clear" data-iguasport-clear="zip" aria-label="Remover pacote ZIP">×</button>
        <span class="client-upload-icon">▣</span>
        <strong>PACOTE .ZIP</strong>
        <small>PDFs do processo dentro do ZIP</small>
        <em>clique para selecionar</em>
      </label>
    </div>
    <div class="client-mode-status iguasport-mode-status" aria-live="polite">Selecione vários PDFs ou utilize um pacote .ZIP.</div>
    <button type="button" class="client-analyze-button iguasport-analyze-button" disabled>Análise IGUASPORT em configuração</button>
  `;
  content.appendChild(detail);

  const pdfInput=detail.querySelector<HTMLInputElement>('[data-iguasport-file="pdfs"]')!;
  const zipInput=detail.querySelector<HTMLInputElement>('[data-iguasport-file="zip"]')!;
  const status=detail.querySelector<HTMLElement>('.iguasport-mode-status')!;

  const setCard=(input:HTMLInputElement)=>{
    const upload=input.closest<HTMLElement>('.client-upload-card');
    if(!upload)return;
    const files=[...(input.files||[])];
    upload.classList.toggle('selected',files.length>0);
    const em=upload.querySelector<HTMLElement>('em');
    if(em){
      if(input===pdfInput&&files.length>1)em.textContent=`${files.length} PDFs selecionados`;
      else em.textContent=files[0]?.name||'clique para selecionar';
    }
    const clear=upload.querySelector<HTMLButtonElement>('.client-file-clear');
    if(clear)clear.hidden=files.length===0;
  };

  const refresh=()=>{
    const pdfs=[...(pdfInput.files||[])];
    const zip=zipInput.files?.[0]||null;
    setCard(pdfInput);setCard(zipInput);
    if(zip)status.textContent=`ZIP selecionado: ${zip.name}`;
    else if(pdfs.length)status.textContent=`${pdfs.length} PDF${pdfs.length===1?'':'s'} selecionado${pdfs.length===1?'':'s'} para IGUASPORT.`;
    else status.textContent='Selecione vários PDFs ou utilize um pacote .ZIP.';
  };

  pdfInput.addEventListener('change',()=>{
    if(pdfInput.files?.length)zipInput.value='';
    refresh();
  });
  zipInput.addEventListener('change',()=>{
    if(zipInput.files?.length)pdfInput.value='';
    refresh();
  });

  detail.querySelectorAll<HTMLButtonElement>('[data-iguasport-clear]').forEach(button=>{
    button.hidden=true;
    button.addEventListener('click',event=>{
      event.preventDefault();
      event.stopPropagation();
      const kind=button.dataset.iguasportClear;
      const input=detail.querySelector<HTMLInputElement>(`[data-iguasport-file="${kind}"]`);
      if(input)input.value='';
      refresh();
    });
  });

  const hideOtherViews=()=>{
    panel.querySelectorAll<HTMLElement>('.clients-list-view,.client-detail-view,.client-report-view').forEach(view=>{
      view.classList.remove('active','leaving');
      view.setAttribute('aria-hidden','true');
    });
    panel.classList.remove('report-mode');
  };

  const showList=()=>{
    detail.classList.remove('active');
    detail.setAttribute('aria-hidden','true');
    list.classList.add('active');
    list.setAttribute('aria-hidden','false');
  };

  card.addEventListener('click',()=>{
    hideOtherViews();
    detail.classList.add('active');
    detail.setAttribute('aria-hidden','false');
    detail.scrollTop=0;
    refresh();
  });
  detail.querySelector('.iguasport-back')?.addEventListener('click',showList);

  document.querySelector('.clients-tab')?.addEventListener('click',()=>{
    detail.classList.remove('active');
    detail.setAttribute('aria-hidden','true');
  });
  document.querySelector('.clients-back-tab')?.addEventListener('click',()=>{
    detail.classList.remove('active');
    detail.setAttribute('aria-hidden','true');
  });

  refresh();
  return true;
}

if(!bindIguasport()){
  const startupObserver=new MutationObserver(()=>{
    if(bindIguasport())startupObserver.disconnect();
  });
  startupObserver.observe(document.documentElement,{childList:true,subtree:true});
}
