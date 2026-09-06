export {};

function enhanceReport(report:HTMLElement){
  report.querySelectorAll<HTMLElement>('.client-report-row').forEach(row=>{
    if(row.querySelector('.client-field-copy'))return;
    const value=row.querySelector<HTMLElement>('.client-report-value');
    if(!value)return;

    const button=document.createElement('button');
    button.type='button';
    button.className='client-field-copy';
    button.textContent='Copiar';
    button.setAttribute('aria-label',`Copiar ${row.querySelector<HTMLElement>('.client-report-field b')?.textContent?.trim()||'valor'}`);

    button.addEventListener('click',async()=>{
      const text=value.textContent?.trim()||'';
      if(!text)return;
      try{
        await navigator.clipboard.writeText(text);
        button.textContent='Copiado ✓';
        button.classList.add('copied');
        window.setTimeout(()=>{
          button.textContent='Copiar';
          button.classList.remove('copied');
        },1200);
      }catch{
        button.textContent='Erro';
        window.setTimeout(()=>{button.textContent='Copiar'},1200);
      }
    });

    row.appendChild(button);
  });
}

function bindReportView(report:HTMLElement){
  if(report.dataset.copyBound==='true')return;
  report.dataset.copyBound='true';
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
