import { IGUASPORT_PROFILE } from './clients/iguasport';
import { runIguasportAnalysis, type IguasportAnalysisSnapshot } from './clients/iguasport-analysis';

export {};

const escapeHtml=(value:string)=>value.replace(/[&<>'"]/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
}[char]||char));

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
    <button type="button" class="client-analyze-button iguasport-analyze-button" disabled>Analisar processo IGUASPORT</button>
  `;
  content.appendChild(detail);

  const report=document.createElement('div');
  report.className='client-report-view iguasport-report-view';
  report.setAttribute('aria-hidden','true');
  content.appendChild(report);

  const pdfInput=detail.querySelector<HTMLInputElement>('[data-iguasport-file="pdfs"]')!;
  const zipInput=detail.querySelector<HTMLInputElement>('[data-iguasport-file="zip"]')!;
  const status=detail.querySelector<HTMLElement>('.iguasport-mode-status')!;
  const analyzeButton=detail.querySelector<HTMLButtonElement>('.iguasport-analyze-button')!;

  const getFiles=()=>({pdfs:[...(pdfInput.files||[])],zip:zipInput.files?.[0]||null});

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
    const {pdfs,zip}=getFiles();
    setCard(pdfInput);setCard(zipInput);
    if(zip)status.textContent=`ZIP selecionado: ${zip.name}`;
    else if(pdfs.length)status.textContent=`${pdfs.length} PDF${pdfs.length===1?'':'s'} selecionado${pdfs.length===1?'':'s'} para IGUASPORT.`;
    else status.textContent='Selecione vários PDFs ou utilize um pacote .ZIP.';
    analyzeButton.disabled=!(zip||pdfs.length);
  };

  pdfInput.addEventListener('change',()=>{if(pdfInput.files?.length)zipInput.value='';refresh()});
  zipInput.addEventListener('change',()=>{if(zipInput.files?.length)pdfInput.value='';refresh()});

  detail.querySelectorAll<HTMLButtonElement>('[data-iguasport-clear]').forEach(button=>{
    button.hidden=true;
    button.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();
      const input=detail.querySelector<HTMLInputElement>(`[data-iguasport-file="${button.dataset.iguasportClear}"]`);
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

  const showReport=(analysis:IguasportAnalysisSnapshot)=>{
    const rows=analysis.fields.map(field=>`
      <div class="client-report-row">
        <div class="client-report-field"><b>${escapeHtml(field.label)}</b><span>${escapeHtml(field.source)}</span></div>
        <div class="client-report-value">${escapeHtml(field.value)}</div>
        <div class="client-report-confidence">${escapeHtml(field.confidence)}</div>
      </div>`).join('');
    report.innerHTML=`
      <div class="client-report-toolbar">
        <button type="button" class="client-report-back iguasport-report-back">← IGUASPORT</button>
        <button type="button" class="client-report-copy iguasport-report-copy">Copiar relatório</button>
      </div>
      <div class="client-report-head">
        <span class="client-report-logo"><img src="${IGUASPORT_PROFILE.logo}" alt="Logo ${IGUASPORT_PROFILE.displayName}"></span>
        <div><span class="clients-kicker">Relatório por cliente</span><h2>Relatório IGUASPORT</h2><p><b>Cliente do relatório: IGUASPORT</b> · ${escapeHtml(analysis.summary)}</p></div>
      </div>
      <div class="client-report-metrics">
        <div><span>Cliente</span><b>IGUASPORT</b></div>
        <div><span>Operação</span><b>${escapeHtml(analysis.processType)}</b></div>
        <div><span>Campos</span><b>${analysis.found}/${analysis.total}</b></div>
      </div>
      <div class="client-report-table">${rows}</div>
      <button type="button" class="client-report-new iguasport-report-new">Nova análise IGUASPORT</button>
    `;
    hideOtherViews();panel.classList.add('report-mode');report.classList.add('active');report.setAttribute('aria-hidden','false');report.scrollTop=0;
    report.querySelector('.iguasport-report-back')?.addEventListener('click',showDetail);
    report.querySelector('.iguasport-report-new')?.addEventListener('click',()=>{pdfInput.value='';zipInput.value='';showDetail()});
    report.querySelector('.iguasport-report-copy')?.addEventListener('click',()=>{
      const text=['Cliente do relatório: IGUASPORT',`Operação: ${analysis.processType}`,'',...analysis.fields.map(f=>`${f.label}: ${f.value}`)].join('\n');
      void navigator.clipboard?.writeText(text);
    });
  };

  analyzeButton.addEventListener('click',async()=>{
    const files=getFiles();
    try{
      analyzeButton.disabled=true;analyzeButton.textContent='Analisando processo IGUASPORT...';status.textContent='Lendo e cruzando os documentos da IGUASPORT...';
      const analysis=await runIguasportAnalysis(files);showReport(analysis);
    }catch(error){status.textContent=error instanceof Error?error.message:'Não foi possível concluir a análise IGUASPORT.'}
    finally{analyzeButton.textContent='Analisar processo IGUASPORT';refresh()}
  });

  card.addEventListener('click',showDetail);
  detail.querySelector('.iguasport-back')?.addEventListener('click',showList);
  document.querySelector('.clients-tab')?.addEventListener('click',()=>{detail.classList.remove('active');report.classList.remove('active')});
  document.querySelector('.clients-back-tab')?.addEventListener('click',()=>{detail.classList.remove('active');report.classList.remove('active')});
  refresh();
  return true;
}

if(!bindIguasport()){
  const startupObserver=new MutationObserver(()=>{if(bindIguasport())startupObserver.disconnect()});
  startupObserver.observe(document.documentElement,{childList:true,subtree:true});
}
