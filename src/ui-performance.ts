export {};

const imageSelector='.client-logo-image img,.client-detail-logo-image img,.client-report-logo img,.clients-brand-panel img,.brand img';

function tuneImage(img:HTMLImageElement){
  if(img.dataset.uiImageOptimized==='true')return;
  img.dataset.uiImageOptimized='true';
  img.decoding='async';
  img.dataset.uiImgReady=img.complete?'true':'false';

  const isVisible=Boolean(img.closest('.active'))||Boolean(img.closest('.brand'));
  img.loading=isVisible?'eager':'lazy';
  if(isVisible)img.fetchPriority='high';

  const ready=()=>{img.dataset.uiImgReady='true'};
  if(img.complete)ready();
  else{
    img.addEventListener('load',ready,{once:true});
    img.addEventListener('error',ready,{once:true});
  }
}

function tune(root:ParentNode=document){
  root.querySelectorAll<HTMLImageElement>(imageSelector).forEach(tuneImage);
}

function prioritizeActiveImages(){
  document.querySelectorAll<HTMLImageElement>('.active img').forEach(img=>{
    img.loading='eager';
    img.fetchPriority='high';
    if(typeof img.decode==='function')void img.decode().catch(()=>{});
  });
}

function idlePredecode(){
  const task=()=>{
    document.querySelectorAll<HTMLImageElement>(imageSelector).forEach(img=>{
      if(img.complete)return;
      const probe=new Image();
      probe.decoding='async';
      probe.src=img.currentSrc||img.src;
      if(typeof probe.decode==='function')void probe.decode().catch(()=>{});
    });
  };
  const ric=(window as any).requestIdleCallback as undefined|((cb:()=>void,opts?:{timeout:number})=>void);
  if(ric)ric(task,{timeout:1800});
  else window.setTimeout(task,700);
}

let frame=0;
const observer=new MutationObserver(records=>{
  let needsTune=false,needsPriority=false;
  for(const record of records){
    if(record.type==='childList'&&record.addedNodes.length)needsTune=true;
    if(record.type==='attributes'&&record.attributeName==='class')needsPriority=true;
  }
  if(!needsTune&&!needsPriority)return;
  cancelAnimationFrame(frame);
  frame=requestAnimationFrame(()=>{
    if(needsTune)tune();
    if(needsPriority)prioritizeActiveImages();
  });
});

const start=()=>{
  tune();
  prioritizeActiveImages();
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  idlePredecode();
};

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
else start();
