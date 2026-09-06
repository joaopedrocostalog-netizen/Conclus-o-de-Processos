type HistoryEntry={id:string;client:string;operation:string;found:string;createdAt:number;fields:Array<{label:string;value:string}>};

const HISTORY_KEY='costalog-client-report-history-v1';
const MAX_HISTORY=8;

const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]||char));
const isProblem=(text:string)=>/não localizado|baixa|média|revis|diverg/i.test(text);

function readHistory():HistoryEntry[]{
  try{return JSON.parse(sessionStorage.getItem(HISTORY_KEY)||'[]') as HistoryEntry[]}catch{return[]}
}
function writeHistory(entries:HistoryEntry[]){
  try{sessionStorage.setItem(HISTORY_KEY,JSON.stringify(entries.slice(0,MAX_HISTORY)))}catch{}
}
function snapshotReport(report:HTMLElement):HistoryEntry|null{
  const title=report.querySelector<HTMLElement>('.client-report-head h2')?.textContent?.trim()||'';
  if(!title)return null;
  const client=title.replace(/^Relatório\s+/i,'').trim()||'Cliente';
  const metrics=[...report.querySelectorAll<HTMLElement>('.client-report-metrics>div')];
  const operation=metrics.find(m=>/Operação/i.test(m.querySelector('span')?.textContent||''))?.querySelector('b')?.textContent?.trim()||'';
  const found=metrics.find(m=>/Campos/i.test(m.querySelector('span')?.textContent||''))?.querySelector('b')?.textContent?.trim()||'';
  const fields=[...report.querySelectorAll<HTMLElement>('.client-report-row')].map(row=>({
    label:row.querySelector<HTMLElement>('.client-report-field b')?.textContent?.trim()||'Campo',
    value:row.querySelector<HTMLElement>('.client-report-value')?.textContent?.trim()||''
  }));
  return{id:`${client}-${Date.now()}`,client,operation,found,createdAt:Date.now(),fields};
}
function saveCurrentReport(report:HTMLElement){
  if(report.dataset.historySaved==='true')return;
  const snap=snapshotReport(report);if(!snap)return;
  const history=readHistory();
  const fingerprint=snap.fields.map(f=>`${f.label}:${f.value}`).join('|');
  const duplicate=history.find(item=>item.client===snap.client&&item.fields.map(f=>`${f.label}:${f.value}`).join('|')===fingerprint);
  if(!duplicate)writeHistory([snap,...history]);
  report.dataset.historySaved='true';
}

function enhanceClientCard(){
  const card=document.querySelector<HTMLElement>('.client-card-glovis');
  if(!card||card.querySelector('.client-capabilities'))return;
  const meta=document.createElement('span');
  meta.className='client-capabilities';
  meta.innerHTML='<span>DOC + NF</span><span>ZIP</span><span>13 campos</span>';
  card.appendChild(meta);
}

function enhanceProcessing(){
  const button=document.querySelector<HTMLButtonElement>('.client-analyze-button');
  const detail=button?.closest<HTMLElement>('.client-detail-view');
  if(!button||!detail||detail.querySelector('.client-analysis-progress'))return;
  const progress=document.createElement('div');
  progress.className='client-analysis-progress';
  progress.hidden=true;
  progress.innerHTML='<div class="client-analysis-progress-track"><span></span></div><div class="client-analysis-progress-text">Preparando análise...</div>';
  button.insertAdjacentElement('beforebegin',progress);
  button.addEventListener('click',()=>{
    if(button.disabled)return;
    progress.hidden=false;
    progress.classList.add('running');
    const text=progress.querySelector<HTMLElement>('.client-analysis-progress-text');
    if(text)text.textContent='Processando documentos com a base validada...';
  });
  const observer=new MutationObserver(()=>{
    const report=document.querySelector<HTMLElement>('.client-report-view.active');
    if(report){progress.classList.remove('running');progress.hidden=true;}
  });
  observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
}

function renderHistoryPanel(report:HTMLElement){
  if(report.querySelector('.client-report-history'))return;
  const history=readHistory();if(!history.length)return;
  const panel=document.createElement('details');
  panel.className='client-report-history';
  panel.innerHTML=`<summary>Histórico desta sessão <span>${history.length}</span></summary><div class="client-report-history-list">${history.map(item=>`<button type="button" data-history-id="${escapeHtml(item.id)}"><b>${escapeHtml(item.client)}</b><span>${escapeHtml(item.operation||'Operação não identificada')} · ${escapeHtml(item.found||'')}</span><small>${new Date(item.createdAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</small></button>`).join('')}</div>`;
  const head=report.querySelector('.client-report-head');
  head?.insertAdjacentElement('afterend',panel);
  panel.querySelectorAll<HTMLButtonElement>('[data-history-id]').forEach(button=>button.addEventListener('click',()=>{
    const item=history.find(h=>h.id===button.dataset.historyId);if(!item)return;
    const rows=[...report.querySelectorAll<HTMLElement>('.client-report-row')];
    item.fields.forEach(field=>{
      const row=rows.find(r=>r.querySelector('.client-report-field b')?.textContent?.trim()===field.label);
      const value=row?.querySelector<HTMLElement>('.client-report-value');if(value)value.textContent=field.value;
    });
    report.scrollTo({top:0,behavior:'smooth'});
  }));
}

function enhanceReport(report:HTMLElement){
  if(report.dataset.workflowEnhanced==='true')return;
  saveCurrentReport(report);
  const rows=[...report.querySelectorAll<HTMLElement>('.client-report-row')];
  if(!rows.length)return;

  const problemCount=rows.filter(row=>isProblem(`${row.querySelector('.client-report-value')?.textContent||''} ${row.querySelector('.client-report-confidence')?.textContent||''}`)).length;
  const controls=document.createElement('div');
  controls.className='client-report-reviewbar';
  controls.innerHTML=`
    <div class="client-report-summary"><b>${problemCount?`${problemCount} campo(s) para revisar`:'Todos os campos localizados'}</b><span>${rows.length-problemCount}/${rows.length} sem alerta</span></div>
    <div class="client-report-tools">
      <input type="search" class="client-report-search" placeholder="Buscar campo..." aria-label="Buscar campo no relatório">
      <button type="button" class="client-report-problems">Somente divergências</button>
      <button type="button" class="client-report-review-toggle">Modo revisão</button>
    </div>`;
  const metrics=report.querySelector('.client-report-metrics');
  metrics?.insertAdjacentElement('afterend',controls);

  let onlyProblems=false;let review=false;
  const search=controls.querySelector<HTMLInputElement>('.client-report-search')!;
  const problemButton=controls.querySelector<HTMLButtonElement>('.client-report-problems')!;
  const reviewButton=controls.querySelector<HTMLButtonElement>('.client-report-review-toggle')!;
  const applyFilter=()=>{
    const q=search.value.trim().toLowerCase();
    rows.forEach(row=>{
      const hay=row.textContent?.toLowerCase()||'';
      const problem=isProblem(`${row.querySelector('.client-report-value')?.textContent||''} ${row.querySelector('.client-report-confidence')?.textContent||''}`);
      row.hidden=Boolean((q&&!hay.includes(q))||(onlyProblems&&!problem));
    });
  };
  search.addEventListener('input',applyFilter);
  problemButton.addEventListener('click',()=>{onlyProblems=!onlyProblems;problemButton.classList.toggle('active',onlyProblems);problemButton.textContent=onlyProblems?'Mostrar todos':'Somente divergências';applyFilter()});
  reviewButton.addEventListener('click',()=>{
    review=!review;report.classList.toggle('review-mode',review);reviewButton.classList.toggle('active',review);reviewButton.textContent=review?'Finalizar revisão':'Modo revisão';
    rows.forEach(row=>{const value=row.querySelector<HTMLElement>('.client-report-value');if(value)value.contentEditable=review?'true':'false'});
  });

  rows.forEach(row=>{
    if(row.querySelector('.client-field-copy'))return;
    const value=row.querySelector<HTMLElement>('.client-report-value');if(!value)return;
    const copy=document.createElement('button');copy.type='button';copy.className='client-field-copy';copy.textContent='Copiar';
    copy.addEventListener('click',()=>{void navigator.clipboard?.writeText(value.textContent?.trim()||'');copy.textContent='Copiado';setTimeout(()=>copy.textContent='Copiar',1200)});
    value.appendChild(copy);
  });

  renderHistoryPanel(report);
  report.dataset.workflowEnhanced='true';
}

function run(){
  enhanceClientCard();
  enhanceProcessing();
  document.querySelectorAll<HTMLElement>('.client-report-view.active').forEach(enhanceReport);
}
const observer=new MutationObserver(run);
observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
