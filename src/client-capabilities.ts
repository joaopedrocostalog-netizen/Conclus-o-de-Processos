export {};

function addCapabilities(){
  const card=document.querySelector<HTMLElement>('.client-card-glovis');
  if(!card||card.querySelector('.client-capabilities'))return false;

  const capabilities=document.createElement('span');
  capabilities.className='client-capabilities';
  capabilities.setAttribute('aria-label','Formatos aceitos e quantidade de campos');
  capabilities.innerHTML='<span>DOC + NF</span><span>ZIP</span><span>13 campos</span>';
  card.appendChild(capabilities);
  return true;
}

if(!addCapabilities()){
  const startupObserver=new MutationObserver(()=>{
    if(addCapabilities())startupObserver.disconnect();
  });
  startupObserver.observe(document.documentElement,{childList:true,subtree:true});
}
