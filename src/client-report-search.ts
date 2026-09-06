export {};

function normalize(value:string){
  return value
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'');
}

function applySearch(report:HTMLElement,input:HTMLInputElement,status:HTMLElement){
  const query=normalize(input.value.trim());
  const rows=[...report.querySelectorAll<HTMLElement>('.client-report-row')];

  let visible=0;
  rows.forEach(row=>{
    const divergenceHidden=row.hidden&&report.classList.contains('show-only-divergences');
    const matches=!query||normalize(row.textContent||'').includes(query);

    // Se o filtro "Somente divergências" estiver ativo, a busca nunca reexibe
    // uma linha que o próprio filtro já ocultou.
    if(report.classList.contains('show-only-divergences')){
      if(divergenceHidden){
        row.dataset.searchHidden='true';
        return;
      }
      row.hidden=!matches;
    }else{
      row.hidden=!matches;
    }

    row.dataset.searchHidden=matches?'false':'true';
    if(!row.hidden)visible++;
  });

  if(!query){
    status.textContent='';
    return;
  }
  status.textContent=visible===1?'1 resultado':`${visible} resultados`;
}

function enhanceReport(report:HTMLElement){
  const rows=report.querySelectorAll('.client-report-row');
  if(!rows.length||report.querySelector('.client-report-search-box'))return;

  const wrap=document.createElement('div');
  wrap.className='client-report-search-box';
  wrap.innerHTML=`
    <div class="client-report-search-field">
      <span aria-hidden="true">⌕</span>
      <input type="search" class="client-report-search-input" placeholder="Buscar no relatório..." autocomplete="off" aria-label="Buscar no relatório">
      <button type="button" class="client-report-search-clear" aria-label="Limpar busca" hidden>×</button>
    </div>
    <span class="client-report-search-status" aria-live="polite"></span>
  `;

  const divergenceControls=report.querySelector('.client-divergence-controls');
  const metrics=report.querySelector('.client-report-metrics');
  if(divergenceControls)divergenceControls.insertAdjacentElement('afterend',wrap);
  else if(metrics)metrics.insertAdjacentElement('afterend',wrap);
  else report.prepend(wrap);

  const input=wrap.querySelector<HTMLInputElement>('.client-report-search-input')!;
  const clear=wrap.querySelector<HTMLButtonElement>('.client-report-search-clear')!;
  const status=wrap.querySelector<HTMLElement>('.client-report-search-status')!;

  input.addEventListener('input',()=>{
    clear.hidden=!input.value;
    applySearch(report,input,status);
  });
  input.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&input.value){
      input.value='';
      clear.hidden=true;
      applySearch(report,input,status);
    }
  });
  clear.addEventListener('click',()=>{
    input.value='';
    clear.hidden=true;
    applySearch(report,input,status);
    input.focus();
  });

  // Sincroniza somente quando o botão de divergências é usado; não observa o DOM.
  report.querySelector('.client-divergence-toggle')?.addEventListener('click',()=>{
    queueMicrotask(()=>applySearch(report,input,status));
  });
}

function bindReport(report:HTMLElement){
  if(report.dataset.searchBound==='true')return;
  report.dataset.searchBound='true';
  enhanceReport(report);

  // O relatório é recriado por innerHTML a cada nova análise. Observamos apenas
  // filhos diretos deste contêiner e paramos assim que os campos aparecem.
  const observer=new MutationObserver(()=>{
    if(report.querySelector('.client-report-row')){
      enhanceReport(report);
    }
  });
  observer.observe(report,{childList:true});
}

function findAndBind(){
  const report=document.querySelector<HTMLElement>('.client-report-view');
  if(!report)return false;
  bindReport(report);
  return true;
}

if(!findAndBind()){
  const startupObserver=new MutationObserver(()=>{
    if(findAndBind())startupObserver.disconnect();
  });
  startupObserver.observe(document.documentElement,{childList:true,subtree:true});
}
