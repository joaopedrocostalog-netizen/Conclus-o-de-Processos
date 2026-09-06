export {};

let setupDone=false;

function setupProgress(){
  if(setupDone)return true;
  const button=document.querySelector<HTMLButtonElement>('.client-analyze-button');
  const detail=button?.closest<HTMLElement>('.client-detail-view');
  if(!button||!detail)return false;

  let progress=detail.querySelector<HTMLElement>('.client-analysis-progress');
  if(!progress){
    progress=document.createElement('div');
    progress.className='client-analysis-progress';
    progress.hidden=true;
    progress.innerHTML=`
      <div class="client-analysis-progress-head">
        <b>Processando documentos</b>
        <span class="client-analysis-progress-time">0s</span>
      </div>
      <div class="client-analysis-progress-track"><span></span></div>
      <div class="client-analysis-progress-text">Preparando análise...</div>
      <div class="client-analysis-progress-subtext">A análise continua usando a mesma base validada.</div>
    `;
    button.insertAdjacentElement('beforebegin',progress);
  }

  let timer:number|null=null;
  let startedAt=0;

  const stop=(state:'done'|'error'='done')=>{
    if(timer!==null){window.clearInterval(timer);timer=null}
    progress!.classList.remove('running');
    progress!.classList.toggle('done',state==='done');
    progress!.classList.toggle('error',state==='error');
  };

  const start=()=>{
    startedAt=performance.now();
    progress!.hidden=false;
    progress!.classList.remove('done','error');
    progress!.classList.add('running');
    const time=progress!.querySelector<HTMLElement>('.client-analysis-progress-time');
    const text=progress!.querySelector<HTMLElement>('.client-analysis-progress-text');
    if(time)time.textContent='0s';
    if(text)text.textContent='Lendo e cruzando os documentos...';

    if(timer!==null)window.clearInterval(timer);
    timer=window.setInterval(()=>{
      const elapsed=Math.max(0,Math.floor((performance.now()-startedAt)/1000));
      if(time)time.textContent=`${elapsed}s`;

      if(text){
        if(elapsed<4)text.textContent='Lendo e cruzando os documentos...';
        else if(elapsed<10)text.textContent='Extraindo informações dos PDFs...';
        else if(elapsed<20)text.textContent='Validando campos e documentos...';
        else text.textContent='Finalizando a conferência do processo...';
      }

      const report=document.querySelector<HTMLElement>('.client-report-view.active');
      const status=detail.querySelector<HTMLElement>('.client-mode-status')?.textContent||'';
      const finished=!button.disabled&&/Analisar processo/i.test(button.textContent||'');
      if(report){
        stop('done');
        if(text)text.textContent='Análise concluída.';
        window.setTimeout(()=>{if(progress)progress.hidden=true},350);
      }else if(finished&&/não foi possível|erro|falha/i.test(status)){
        stop('error');
        if(text)text.textContent='A análise não foi concluída.';
      }
    },500);
  };

  button.addEventListener('click',()=>{
    if(button.disabled)return;
    start();
  });

  setupDone=true;
  return true;
}

if(!setupProgress()){
  const setupObserver=new MutationObserver(()=>{
    if(setupProgress())setupObserver.disconnect();
  });
  setupObserver.observe(document.documentElement,{childList:true,subtree:true});
  window.setTimeout(()=>setupObserver.disconnect(),10000);
}
