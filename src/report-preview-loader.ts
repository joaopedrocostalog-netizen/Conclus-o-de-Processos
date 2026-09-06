let loaded=false;
let loading:Promise<unknown>|null=null;

function loadReportPreviewTools(){
  if(loaded)return Promise.resolve();
  if(loading)return loading;
  loading=Promise.all([
    import('./report-sources'),
    import('./report-weight-preview-fix')
  ]).then(()=>{loaded=true});
  return loading;
}

function hasReportRows(root:ParentNode=document){
  return !!root.querySelector?.('.client-report-row');
}

if(hasReportRows())void loadReportPreviewTools();

const observer=new MutationObserver(mutations=>{
  if(loaded){observer.disconnect();return;}
  for(const mutation of mutations){
    for(const node of mutation.addedNodes){
      if(!(node instanceof Element))continue;
      if(node.matches('.client-report-row')||node.querySelector('.client-report-row')){
        observer.disconnect();
        void loadReportPreviewTools();
        return;
      }
    }
  }
});

observer.observe(document.documentElement,{childList:true,subtree:true});
