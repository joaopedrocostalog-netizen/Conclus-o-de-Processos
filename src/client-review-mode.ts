export {};

function currentValue(row:HTMLElement){
  return row.querySelector<HTMLElement>('.client-report-value')?.textContent?.trim()||'';
}

function bindRow(row:HTMLElement){
  if(row.dataset.reviewBound==='true')return;
  row.dataset.reviewBound='true';
  const value=row.querySelector<HTMLElement>('.client-report-value');
  if(!value)return;
  value.dataset.originalValue=value.textContent?.trim()||'';
  value.spellcheck=false;
  value.addEventListener('input',()=>{
    const edited=(value.textContent?.trim()||'')!==(value.dataset.originalValue||'');
    row.classList.toggle('client-review-edited',edited);
    let badge=row.querySelector<HTMLElement>('.client-review-edited-badge');
    if(edited&&!badge){
      badge=document.createElement('span');
      badge.className='client-review-edited-badge';
      badge.textContent='Editado manualmente';
      row.appendChild(badge);
    }else if(!edited&&badge){
      badge.remove();
    }
  });
}

function applyReviewState(report:HTMLElement,enabled:boolean){
  report.classList.toggle('client-review-mode',enabled);
  report.querySelectorAll<HTMLElement>('.client-report-value').forEach(value=>{
    value.contentEditable=enabled?'true':'false';
    value.setAttribute('aria-readonly',enabled?'false':'true');
  });
  const button=report.querySelector<HTMLButtonElement>('.client-review-toggle');
  if(button){
    button.classList.toggle('active',enabled);
    button.textContent=enabled?'Finalizar revisão':'Modo revisão';
    button.setAttribute('aria-pressed',String(enabled));
  }
}

function addReviewButton(report:HTMLElement){
  const toolbar=report.querySelector<HTMLElement>('.client-report-toolbar');
  if(!toolbar||toolbar.querySelector('.client-review-toggle'))return;
  const button=document.createElement('button');
  button.type='button';
  button.className='client-review-toggle';
  button.textContent='Modo revisão';
  button.setAttribute('aria-pressed','false');
  button.addEventListener('click',()=>applyReviewState(report,!report.classList.contains('client-review-mode')));
  toolbar.appendChild(button);
}

function bindEditedReportCopy(report:HTMLElement){
  const button=report.querySelector<HTMLButtonElement>('.client-report-copy');
  if(!button||button.dataset.reviewCopyBound==='true')return;
  button.dataset.reviewCopyBound='true';
  button.addEventListener('click',event=>{
    if(!report.querySelector('.client-review-edited'))return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const client=report.querySelector<HTMLElement>('.client-report-head h2')?.textContent?.replace(/^Relatório\s+/i,'').trim()||'Cliente';
    const operation=[...report.querySelectorAll<HTMLElement>('.client-report-metrics>div')]
      .find(item=>/Operação/i.test(item.querySelector('span')?.textContent||''))?.querySelector('b')?.textContent?.trim()||'';
    const lines=[...report.querySelectorAll<HTMLElement>('.client-report-row')].map(row=>{
      const label=row.querySelector<HTMLElement>('.client-report-field b')?.textContent?.trim()||'Campo';
      return `${label}: ${currentValue(row)}`;
    });
    const text=[`Cliente do relatório: ${client}`,`Operação: ${operation}`,'',...lines].join('\n');
    void navigator.clipboard?.writeText(text);
  },true);
}

function enhanceReport(report:HTMLElement){
  addReviewButton(report);
  report.querySelectorAll<HTMLElement>('.client-report-row').forEach(bindRow);
  bindEditedReportCopy(report);
}

function bindReportView(report:HTMLElement){
  if(report.dataset.reviewModeBound==='true')return;
  report.dataset.reviewModeBound='true';
  enhanceReport(report);
  const reportObserver=new MutationObserver(()=>enhanceReport(report));
  reportObserver.observe(report,{childList:true,subtree:true});
}

function findAndBind(){
  const report=document.querySelector<HTMLElement>('.client-report-view');
  if(!report)return false;
  bindReportView(report);
  return true;
}

if(!findAndBind()){
  const startupObserver=new MutationObserver(()=>{
    if(findAndBind())startupObserver.disconnect();
  });
  startupObserver.observe(document.documentElement,{childList:true,subtree:true});
}
