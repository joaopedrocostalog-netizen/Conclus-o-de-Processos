import { CEVA_PROFILE } from './clients/ceva';

export {};

function bindCeva(){
  const panel=document.querySelector<HTMLElement>('.clients-panel');
  const content=panel?.querySelector<HTMLElement>('.clients-content-panel');
  const list=panel?.querySelector<HTMLElement>('.clients-list-view');
  const grid=list?.querySelector<HTMLElement>('.clients-grid');
  if(!panel||!content||!list||!grid)return false;
  if(grid.querySelector('.client-card-ceva'))return true;

  const card=document.createElement('button');
  card.type='button';
  card.className='client-card client-card-ceva';
  card.setAttribute('aria-label',`Abrir cliente ${CEVA_PROFILE.name}`);
  card.innerHTML=`
    <span class="client-logo-image"><img src="${CEVA_PROFILE.logo}" alt="Logo ${CEVA_PROFILE.displayName}"></span>
    <strong>${CEVA_PROFILE.name}</strong>
    <small>Lógica própria por cliente</small>
    <span class="client-capabilities" aria-label="Cliente em configuração"><span>Configurar</span></span>
  `;
  grid.appendChild(card);

  const detail=document.createElement('div');
  detail.className='client-detail-view ceva-detail-view';
  detail.setAttribute('aria-hidden','true');
  detail.innerHTML=`
    <button type="button" class="client-detail-back ceva-back">← Clientes</button>
    <div class="client-detail-head">
      <span class="client-detail-logo client-detail-logo-image"><img src="${CEVA_PROFILE.logo}" alt="Logo ${CEVA_PROFILE.displayName}"></span>
      <div>
        <span class="clients-kicker">Processo por cliente</span>
        <h2>${CEVA_PROFILE.name}</h2>
        <p>${CEVA_PROFILE.description}</p>
      </div>
    </div>
    <div class="ceva-mode-note">
      <b>CEVA</b>
      <span>A estrutura do cliente já está criada e isolada. O próximo passo será definir quais arquivos a CEVA recebe e quais informações deverão ser extraídas.</span>
    </div>
  `;
  content.appendChild(detail);

  const hideOtherViews=()=>{
    panel.querySelectorAll<HTMLElement>('.clients-list-view,.client-detail-view,.client-report-view').forEach(view=>{
      view.classList.remove('active','leaving');view.setAttribute('aria-hidden','true');
    });
    panel.classList.remove('report-mode');
  };
  const showList=()=>{hideOtherViews();list.classList.add('active');list.setAttribute('aria-hidden','false')};
  const showDetail=()=>{hideOtherViews();detail.classList.add('active');detail.setAttribute('aria-hidden','false');detail.scrollTop=0};

  card.addEventListener('click',showDetail);
  detail.querySelector('.ceva-back')?.addEventListener('click',showList);
  document.querySelector('.clients-tab')?.addEventListener('click',()=>detail.classList.remove('active'));
  document.querySelector('.clients-back-tab')?.addEventListener('click',()=>detail.classList.remove('active'));
  return true;
}

if(!bindCeva()){
  const startupObserver=new MutationObserver(()=>{if(bindCeva())startupObserver.disconnect()});
  startupObserver.observe(document.documentElement,{childList:true,subtree:true});
}
