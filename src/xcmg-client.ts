import { XCMG_PROFILE } from './clients/xcmg';
import { readXcmgSpreadsheet, type XcmgSpreadsheetSnapshot } from './clients/xcmg-spreadsheet';

export {};

const XCMG_REPORT_FIELDS=Object.freeze([
  'Cliente','Tipo Documento','Remetente / Exportador','Nº BL / AWB','Local de Armazenagem','Ref. do Cliente','Nº Documento','Destinatário / Importador','Operação Marítima','Agência Marítima','CNPJ do Cliente / Importador','Contêineres','Peso Líquido','Valor Total da Nota'
] as const);

const escapeHtml=(value:string)=>value.replace(/[&<>'"]/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
}[char]||char));

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
    <span class="client-capabilities" aria-label="Formatos aceitos"><span>Excel obrigatório</span><span>NF ou ZIP</span></span>
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
    <div class="xcmg-mode-note"><b>PLANILHA OBRIGATÓRIA</b><span>Envie sempre a planilha Excel e escolha também uma NF Fiscal em PDF ou um pacote .ZIP. NF e ZIP continuam sendo modos alternativos.</span></div>
    <div class="xcmg-upload-grid">
      <label class="client-upload-card xcmg-sheet-card">
        <input type="file" accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" data-xcmg-file="sheet" hidden>
        <button type="button" class="client-file-clear" data-xcmg-clear="sheet" aria-label="Remover planilha Excel">×</button>
        <span class="client-upload-icon">▦</span>
        <strong>PLANILHA EXCEL</strong>
        <small class="client-required">Obrigatória em todas as análises</small>
        <em>clique para selecionar</em>
      </label>
      <label class="client-upload-card xcmg-nf-card">
        <input type="file" accept="application/pdf,.pdf" data-xcmg-file="nf" hidden>
        <button type="button" class="client-file-clear" data-xcmg-clear="nf" aria-label="Remover NF Fiscal">×</button>
        <span class="client-upload-icon">▤</span>
        <strong>NF FISCAL</strong>
        <small>Use junto com a planilha</small>
        <em>clique para selecionar</em>
      </label>
      <label class="client-upload-card xcmg-zip-card">
        <input type="file" accept=".zip,application/zip" data-xcmg-file="zip" hidden>
        <button type="button" class="client-file-clear" data-xcmg-clear="zip" aria-label="Remover pacote ZIP">×</button>
        <span class="client-upload-icon">▣</span>
        <strong>PACOTE .ZIP</strong>
        <small>Use junto com a planilha</small>
        <em>clique para selecionar</em>
      </label>
    </div>
    <div class="client-mode-status xcmg-mode-status" aria-live="polite">Envie a planilha obrigatória e depois selecione NF ou ZIP.</div>
    <button type="button" class="client-analyze-button xcmg-analyze-button" disabled>Analisar processo XCMG</button>
  `;
  content.appendChild(detail);

  const report=document.createElement('div');
  report.className='client-report-view xcmg-report-view';
  report.setAttribute('aria-hidden','true');
  content.appendChild(report);

  const sheetInput=detail.querySelector<HTMLInputElement>('[data-xcmg-file="sheet"]')!;
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
    const sheet=sheetInput.files?.[0]||null,nf=nfInput.files?.[0]||null,zip=zipInput.files?.[0]||null;
    setCard(sheetInput);setCard(nfInput);setCard(zipInput);
    if(!sheet&&!(nf||zip))status.textContent='Envie a planilha obrigatória e depois selecione NF ou ZIP.';
    else if(!sheet)status.textContent='Falta a planilha Excel obrigatória para liberar a análise.';
    else if(!(nf||zip))status.textContent=`Planilha selecionada: ${sheet.name}. Agora selecione NF ou ZIP.`;
    else if(zip)status.textContent=`Pronto: planilha ${sheet.name} + ZIP ${zip.name}.`;
    else status.textContent=`Pronto: planilha ${sheet.name} + NF ${nf?.name}.`;
    analyzeButton.disabled=!(sheet&&(nf||zip));
  };

  sheetInput.addEventListener('change',refresh);
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

  const showReport=(spreadsheet:XcmgSpreadsheetSnapshot,mode:'NF'|'ZIP',supportFile:File)=>{
    const rows=XCMG_REPORT_FIELDS.map(label=>{
      const isClient=label==='Cliente';
      const value=isClient?'XCMG':'—';
      const source=isClient?'Cliente selecionado':'Aguardando lógica exclusiva da XCMG';
      const confidence=isClient?'Alta':'Pendente';
      return `
        <div class="client-report-row">
          <div class="client-report-field"><b>${escapeHtml(label)}</b><span>${escapeHtml(source)}</span></div>
          <div class="client-report-value">${escapeHtml(value)}</div>
          <div class="client-report-confidence">${escapeHtml(confidence)}</div>
        </div>`;
    }).join('');

    report.innerHTML=`
      <div class="client-report-toolbar">
        <button type="button" class="client-report-back xcmg-report-back">← XCMG</button>
        <button type="button" class="client-report-copy xcmg-report-copy">Copiar relatório</button>
      </div>
      <div class="client-report-head">
        <span class="client-report-logo"><img src="${XCMG_PROFILE.logo}" alt="Logo ${XCMG_PROFILE.displayName}"></span>
        <div>
          <span class="clients-kicker">Relatório por cliente</span>
          <h2>Relatório XCMG</h2>
          <p><b>Cliente do relatório: XCMG</b> · Campos definidos para a base exclusiva deste cliente.</p>
        </div>
      </div>
      <div class="client-report-metrics">
        <div><span>Cliente</span><b>XCMG</b></div>
        <div><span>Entrada</span><b>Excel + ${mode}</b></div>
        <div><span>Campos</span><b>1/${XCMG_REPORT_FIELDS.length}</b></div>
      </div>
      <div class="client-report-table">${rows}</div>
      <button type="button" class="client-report-new xcmg-report-new">Nova análise XCMG</button>
    `;
    hideOtherViews();
    panel.classList.add('report-mode');
    report.classList.add('active');
    report.setAttribute('aria-hidden','false');
    report.scrollTop=0;

    report.querySelector('.xcmg-report-back')?.addEventListener('click',showDetail);
    report.querySelector('.xcmg-report-new')?.addEventListener('click',()=>{
      sheetInput.value='';nfInput.value='';zipInput.value='';showDetail();
    });
    report.querySelector('.xcmg-report-copy')?.addEventListener('click',()=>{
      const text=[
        'Cliente do relatório: XCMG',
        `Entrada: Excel + ${mode}`,
        `Planilha: ${spreadsheet.filename}`,
        `Documento complementar: ${supportFile.name}`,
        '',
        ...XCMG_REPORT_FIELDS.map(label=>`${label}: ${label==='Cliente'?'XCMG':'—'}`)
      ].join('\n');
      void navigator.clipboard?.writeText(text);
    });
  };

  analyzeButton.addEventListener('click',async()=>{
    const sheet=sheetInput.files?.[0]||null,nf=nfInput.files?.[0]||null,zip=zipInput.files?.[0]||null;
    if(!sheet||!(nf||zip)){refresh();return;}
    try{
      analyzeButton.disabled=true;
      analyzeButton.textContent='Analisando processo XCMG...';
      status.textContent='Lendo a planilha obrigatória da XCMG...';
      const spreadsheet=await readXcmgSpreadsheet(sheet);
      if(zip)showReport(spreadsheet,'ZIP',zip);
      else if(nf)showReport(spreadsheet,'NF',nf);
    }catch(error){
      status.textContent=error instanceof Error?`Não foi possível ler a planilha: ${error.message}`:'Não foi possível ler a planilha XCMG.';
    }finally{
      analyzeButton.textContent='Analisar processo XCMG';
      refresh();
    }
  });

  card.addEventListener('click',showDetail);
  detail.querySelector('.xcmg-back')?.addEventListener('click',showList);
  document.querySelector('.clients-tab')?.addEventListener('click',()=>{detail.classList.remove('active');report.classList.remove('active')});
  document.querySelector('.clients-back-tab')?.addEventListener('click',()=>{detail.classList.remove('active');report.classList.remove('active')});
  refresh();
  return true;
}

if(!bindXcmg()){
  const startupObserver=new MutationObserver(()=>{if(bindXcmg())startupObserver.disconnect()});
  startupObserver.observe(document.documentElement,{childList:true,subtree:true});
}
