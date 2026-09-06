export {};

type HistoryField={label:string;value:string};
type HistoryEntry={
  id:string;
  client:string;
  operation:string;
  found:string;
  createdAt:number;
  fields:HistoryField[];
};

const STORAGE_KEY='costalog-client-report-history-v2';
const MAX_ENTRIES=8;

function readHistory():HistoryEntry[]{
  try{
    const parsed=JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'[]');
    return Array.isArray(parsed)?parsed.slice(0,MAX_ENTRIES):[];
  }catch{return[]}
}

function writeHistory(entries:HistoryEntry[]){
  try{sessionStorage.setItem(STORAGE_KEY,JSON.stringify(entries.slice(0,MAX_ENTRIES)))}catch{}
}

function getMetric(report:HTMLElement,label:RegExp){
  const metric=[...report.querySelectorAll<HTMLElement>('.client-report-metrics>div')]
    .find(item=>label.test(item.querySelector('span')?.textContent||''));
  return metric?.querySelector('b')?.textContent?.trim()||'';
}

function snapshot(report:HTMLElement):HistoryEntry|null{
  const rows=[...report.querySelectorAll<HTMLElement>('.client-report-row')];
  if(!rows.length)return null;

  const title=report.querySelector<HTMLElement>('.client-report-head h2')?.textContent?.trim()||'';
  const client=title.replace(/^Relatório\s+/i,'').trim()||'Cliente';
  const fields=rows.map(row=>({
    label:row.querySelector<HTMLElement>('.client-report-field b')?.textContent?.trim()||'Campo',
    value:row.querySelector<HTMLElement>('.client-report-value')?.textContent?.trim()||''
  }));

  return{
    id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    client,
    operation:getMetric(report,/Operação/i),
    found:getMetric(report,/Campos/i),
    createdAt:Date.now(),
    fields
  };
}

function fingerprint(entry:HistoryEntry){
  return `${entry.client}|${entry.operation}|${entry.fields.map(field=>`${field.label}:${field.value}`).join('|')}`;
}

function saveCurrent(report:HTMLElement){
  const entry=snapshot(report);
  if(!entry)return false;
  const history=readHistory();
  const key=fingerprint(entry);
  if(history.some(item=>fingerprint(item)===key))return false;
  writeHistory([entry,...history]);
  return true;
}

function formatTime(timestamp:number){
  return new Date(timestamp).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}

function renderHistory(report:HTMLElement){
  const history=readHistory();
  let panel=report.querySelector<HTMLElement>('.client-session-history');

  if(!history.length){
    panel?.remove();
    return;
  }

  if(!panel){
    panel=document.createElement('details');
    panel.className='client-session-history';
    const head=report.querySelector('.client-report-head');
    if(head)head.insertAdjacentElement('afterend',panel);
    else report.prepend(panel);
  }

  const open=panel.hasAttribute('open');
  panel.innerHTML=`
    <summary>Histórico desta sessão <span>${history.length}</span></summary>
    <div class="client-session-history-list">
      ${history.map((entry,index)=>`
        <details class="client-session-history-entry" ${index===0?'data-latest="true"':''}>
          <summary>
            <span><b>${escapeHtml(entry.client)}</b><small>${escapeHtml(entry.operation||'Operação não identificada')} · ${escapeHtml(entry.found||'')}</small></span>
            <time>${formatTime(entry.createdAt)}</time>
          </summary>
          <div class="client-session-history-fields">
            ${entry.fields.map(field=>`<div><b>${escapeHtml(field.label)}</b><span>${escapeHtml(field.value||'Não localizado')}</span></div>`).join('')}
          </div>
        </details>`).join('')}
    </div>`;
  if(open)panel.setAttribute('open','');
}

function escapeHtml(value:string){
  return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]||char));
}

function processNewReport(report:HTMLElement){
  if(!report.querySelector('.client-report-row'))return;
  const signature=[...report.querySelectorAll<HTMLElement>('.client-report-row')]
    .map(row=>`${row.querySelector('.client-report-field b')?.textContent||''}:${row.querySelector('.client-report-value')?.textContent||''}`)
    .join('|');
  if(report.dataset.historySignature===signature){
    renderHistory(report);
    return;
  }
  report.dataset.historySignature=signature;
  saveCurrent(report);
  renderHistory(report);
}

function bindReport(report:HTMLElement){
  if(report.dataset.sessionHistoryBound==='true')return;
  report.dataset.sessionHistoryBound='true';
  processNewReport(report);

  // Observa apenas substituições diretas do conteúdo do relatório. Não observa a
  // árvore inteira, evitando loops durante análise, previews, filtros e edição.
  const reportObserver=new MutationObserver(mutations=>{
    const hasNewReport=mutations.some(mutation=>[...mutation.addedNodes].some(node=>
      node instanceof Element && (node.matches('.client-report-head,.client-report-table')||node.querySelector('.client-report-row'))
    ));
    if(hasNewReport)queueMicrotask(()=>processNewReport(report));
  });
  reportObserver.observe(report,{childList:true});

  report.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target.closest('button'):null;
    if(!target)return;
    if(target.matches('.client-report-back,.client-report-new')){
      saveCurrent(report);
      renderHistory(report);
      return;
    }
    if(target.matches('.client-review-toggle')){
      queueMicrotask(()=>{
        // Ao finalizar uma revisão, salva uma nova versão somente se houve mudança.
        if(!report.classList.contains('review-mode')){
          saveCurrent(report);
          renderHistory(report);
        }
      });
    }
  });
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
