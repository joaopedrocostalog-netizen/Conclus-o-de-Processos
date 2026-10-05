export {};

function placeClientsButton(){
  const hero=document.querySelector<HTMLElement>('.hero');
  const button=document.querySelector<HTMLButtonElement>('.clients-tab');
  if(!hero||!button)return false;

  let entry=hero.querySelector<HTMLElement>('.clients-entry-card');
  if(!entry){
    entry=document.createElement('div');
    entry.className='clients-entry-card';
    entry.innerHTML=`
      <div class="clients-entry-copy">
        <strong>Processos por cliente</strong>
        <span>Cada cliente possui sua própria base de leitura e conferência, mantendo os relatórios separados e identificados.</span>
      </div>
    `;
    hero.appendChild(entry);
  }

  if(button.parentElement!==entry)entry.appendChild(button);
  return true;
}

if(!placeClientsButton()){
  const observer=new MutationObserver(()=>{
    if(placeClientsButton())observer.disconnect();
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
}
