import { BRASALPLA_PROFILE } from './clients/brasalpla';
export {};

function bindBrasalpla(){
  const panel=document.querySelector<HTMLElement>('.clients-panel');
  const content=panel?.querySelector<HTMLElement>('.clients-content-panel');
  const list=panel?.querySelector<HTMLElement>('.clients-list-view');
  const grid=list?.querySelector<HTMLElement>('.clients-grid');
  if(!panel||!content||!list||!grid)return false;
  if(grid.querySelector('.client-card-brasalpla'))return true;

  const card=document.createElement('button');
  card.type='button';
  card.className='client-card client-card-brasalpla';
  card.setAttribute('aria-label','Abrir cliente BRASALPLA');
  card.innerHTML=`
    <span class="client-logo-image"><img src="${BRASALPLA_PROFILE.logo}" alt="Logo BRASALPLA"></span>
    <strong>BRASALPLA</strong>
  `;
  grid.appendChild(card);

  const detail=document.createElement('div');
  detail.className='client-detail-view brasalpla-detail-view';
  detail.setAttribute('aria-hidden','true');
  detail.innerHTML=`
    <button type="button" class="client-detail-back brasalpla-back">← Clientes</button>
    <div class="client-detail-head">
      <span class="client-detail-logo client-detail-logo-image"><img src="${BRASALPLA_PROFILE.logo}" alt="Logo BRASALPLA"></span>
      <div><span class="clients-kicker">Processo por cliente</span><h2>BRASALPLA</h2><p>${BRASALPLA_PROFILE.description}</p></div>
    </div>
    <div class="brasalpla-mode-note">Cliente cadastrado. Os formatos de arquivos e os campos do relatório serão configurados após a definição dos documentos BRASALPLA.</div>
  `;
  content.appendChild(detail);
  const hideViews=()=>{
    panel.querySelectorAll<HTMLElement>('.clients-list-view,.client-detail-view,.client-report-view').forEach(view=>{
      view.classList.remove('active','leaving');view.setAttribute('aria-hidden','true');
    });
    panel.classList.remove('report-mode');
  };
  const showList=()=>{hideViews();list.classList.add('active');list.setAttribute('aria-hidden','false')};
  const showDetail=()=>{hideViews();detail.classList.add('active');detail.setAttribute('aria-hidden','false')};
  card.addEventListener('click',showDetail);
  detail.querySelector('.brasalpla-back')?.addEventListener('click',showList);
  document.querySelector('.clients-tab')?.addEventListener('click',()=>detail.classList.remove('active'));
  document.querySelector('.clients-back-tab')?.addEventListener('click',()=>detail.classList.remove('active'));
  return true;
}
if(!bindBrasalpla()){
  const observer=new MutationObserver(()=>{if(bindBrasalpla())observer.disconnect()});
  observer.observe(document.documentElement,{childList:true,subtree:true});
}
