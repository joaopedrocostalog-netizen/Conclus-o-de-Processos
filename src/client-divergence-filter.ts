export {};

const isDivergence=(row:HTMLElement)=>{
  const value=row.querySelector<HTMLElement>('.client-report-value')?.textContent||'';
  const confidence=row.querySelector<HTMLElement>('.client-report-confidence')?.textContent||'';
  const source=row.querySelector<HTMLElement>('.client-report-field span,.client-report-source-detail')?.textContent||'';
  return /não localizado|baixa|média|revis|diverg/i.test(`${value} ${confidence} ${source}`);
};

function enhanceReport(report:HTMLElement){
  const rows=[...report.querySelectorAll<HTMLElement>('.client-report-row')];
  if(!rows.length)return;

  let controls=report.querySelector<HTMLElement>('.client-divergence-controls');
  if(!controls){
    controls=document.createElement('div');
    controls.className='client-divergence-controls';
    controls.innerHTML='<button type="button" class="client-divergence-toggle" aria-pressed="false">Somente divergências</button><span class="client-divergence-count"></span>';
    const metrics=report.querySelector('.client-report-metrics');
    if(metrics)metrics.insertAdjacentElement('afterend',controls);
    else report.prepend(controls);

    const button=controls.querySelector<HTMLButtonElement>('.client-divergence-toggle')!;
    button.addEventListener('click',()=>{
      const active=button.getAttribute('aria-pressed')!=='true';
      button.setAttribute('aria-pressed',String(active));
      button.classList.toggle('active',active);
      button.textContent=active?'Mostrar todos':'Somente divergências';
      report.classList.toggle('show-only-divergences',active);
      [...report.querySelectorAll<HTMLElement>('.client-report-row')].forEach(row=>{
        row.hidden=active&&!isDivergence(row);
      });
      updateCount(report);
    });
  }
  updateCount(report);
}

function updateCount(report:HTMLElement){
  const rows=[...report.querySelectorAll<HTMLElement>('.client-report-row')];
  const divergences=rows.filter(isDivergence).length;
  const count=report.querySelector<HTMLElement>('.client-divergence-count');
  if(count)count.textContent=divergences?`${divergences} campo${divergences===1?'':'s'} para revisar`:'Nenhuma divergência encontrada';
}

function bindReport(report:HTMLElement){
  if(report.dataset.divergenceBound==='true')return;
  report.dataset.divergenceBound='true';
  enhanceReport(report);
  const reportObserver=new MutationObserver(()=>enhanceReport(report));
  reportObserver.observe(report,{childList:true,subtree:true});
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
