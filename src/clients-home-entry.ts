export {};

function placeClientsButton(){
  const hero=document.querySelector<HTMLElement>('.hero');
  const button=document.querySelector<HTMLButtonElement>('.clients-tab');
  if(!hero||!button)return false;

  let entry=hero.querySelector<HTMLElement>('.clients-entry-card');
  if(!entry){
    entry=document.createElement('div');
    entry.className='clients-entry-card';
    hero.appendChild(entry);
  }

  entry.querySelector('.clients-entry-copy')?.remove();
  if(button.parentElement!==entry)entry.appendChild(button);
  return true;
}

if(!placeClientsButton()){
  const observer=new MutationObserver(()=>{
    if(placeClientsButton())observer.disconnect();
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
}
