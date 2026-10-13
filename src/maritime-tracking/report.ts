import {isMaritimeProviderConfigured,lookupMaritimeContainer} from './provider';
import {normalizeContainer} from './types';

/** Presentation only: never mutates the clients' extracted field values or parsers. */
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
function fieldValue(report:HTMLElement,labels:RegExp):string{
  for(const row of report.querySelectorAll<HTMLElement>('.client-report-row')){
    const label=row.querySelector('.client-report-field b')?.textContent||'';
    if(labels.test(label))return row.querySelector('.client-report-value')?.textContent?.trim()||'';
  }
  return '';
}
function containers(report:HTMLElement):string[]{
  const raw=fieldValue(report,/Cont[eê]ineres/i);
  return [...new Set((raw.match(/[A-Z]{4}[\s-]?\d{3}[\s-]?\d{4}/gi)||[])
    .map(value=>normalizeContainer(value)).filter((x):x is string=>!!x))];
}
function render(report:HTMLElement){
  if(report.querySelector('.maritime-compare'))return;
  const carrier=fieldValue(report,/Ag[eê]ncia Mar[ií]tima|Armador/i);
  const bl=fieldValue(report,/N[ºo°.]?\s*BL|AWB/i);
  const ids=containers(report);
  const root=document.createElement('section');
  root.className='maritime-compare';
  root.setAttribute('aria-label','Comparação de dados marítimos');
  root.innerHTML=`<h3>Conferência marítima por contêiner</h3>
    <p>Os dados dos documentos e da consulta automática são independentes. A consulta externa não substitui o relatório.</p>
    <div class="maritime-compare-container">Contêineres identificados: ${esc(ids.join(', ')||'nenhum')}</div>
    <div class="maritime-compare-grid">
      <div class="maritime-compare-col"><h4>Análise dos documentos</h4>
        <dl><dt>Armador / Agência Marítima</dt><dd>${esc(carrier||'Não localizado')}</dd>
        <dt>Nº BL / AWB</dt><dd>${esc(bl||'Não localizado')}</dd></dl>
        <div class="maritime-compare-source">Fonte: PDFs e/ou planilhas do relatório</div>
      </div>
      <div class="maritime-compare-col"><h4>Consulta automática · eTracking</h4>
        <dl><dt>Armador</dt><dd data-maritime-carrier>Não consultado</dd>
        <dt>Nº BL</dt><dd data-maritime-bl>Não consultado</dd></dl>
        <div class="maritime-compare-source" data-maritime-source>API ainda não configurada</div>
      </div>
    </div><p class="maritime-compare-status" role="status" data-maritime-status>${!ids.length?'Nenhum contêiner válido disponível para consulta.':isMaritimeProviderConfigured()?'Integração configurada. Pronta para consultar.':'Aguardando os detalhes da API do eTracking. Nenhum resultado online foi presumido.'}</p>`;
  report.appendChild(root);
  if(!ids.length||!isMaritimeProviderConfigured())return;
  const state=root.querySelector<HTMLElement>('[data-maritime-status]')!;
  state.textContent='Consultando os contêineres...';
  void Promise.all(ids.map(lookupMaritimeContainer)).then(results=>{
    if(!root.isConnected)return;
    const carriers=[...new Set(results.map(x=>x.carrier).filter(Boolean))];
    const bls=[...new Set(results.map(x=>x.bl).filter(Boolean))];
    root.querySelector<HTMLElement>('[data-maritime-carrier]')!.textContent=carriers.join(' / ')||'Não localizado';
    root.querySelector<HTMLElement>('[data-maritime-bl]')!.textContent=bls.join(' / ')||'Não localizado';
    const sources=results.map(x=>x.sourceUrl).filter(Boolean);
    root.querySelector<HTMLElement>('[data-maritime-source]')!.textContent=sources.length?'Fonte: '+sources.join(' · '):'Fonte online não fornecida';
    const docMatch=carriers.length&&bls.length&&carrier&&bl
      ?(carriers.some(x=>x?.toUpperCase()===carrier.toUpperCase())&&bls.some(x=>x?.toUpperCase()===bl.toUpperCase())?'Resultados coincidentes':'Há divergências para conferência')
      :'Consulta concluída; verifique campos ausentes ou divergentes';
    state.textContent=results.every(x=>x.status==='error')?'Consulta indisponível; dados documentais preservados.':docMatch;
  });
}
function enhance(){
  document.querySelectorAll<HTMLElement>('.client-report-view.active').forEach(report=>{
    if(report.querySelector('.client-report-table'))render(report);
  });
}
const observer=new MutationObserver(enhance);
const start=()=>{enhance();observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']})};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
