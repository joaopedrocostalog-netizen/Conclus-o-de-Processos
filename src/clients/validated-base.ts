export type ClientProcessFiles={doc:File|null;nf:File|null;zip:File|null};
export type ClientAnalysisField={label:string;value:string;confidence:string;source:string};
export type ClientAnalysisSnapshot={processType:string;summary:string;found:number;total:number;fields:ClientAnalysisField[]};

export const VALIDATED_ANALYSIS_BASE=Object.freeze({
  id:'validated-base-v1',
  label:'Base validada de Conclusão de Processos',
  description:'Reutiliza exatamente o fluxo já validado no cartão principal, sem duplicar nem alterar as regras de extração.',
  modes:Object.freeze({
    pair:Object.freeze({docRequired:true,nfRequired:true}),
    zip:Object.freeze({enabled:true})
  })
});

function assignFile(input:HTMLInputElement,file:File){
  const dt=new DataTransfer();
  dt.items.add(file);
  input.files=dt.files;
  input.dispatchEvent(new Event('change',{bubbles:true}));
}

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

async function waitFor<T extends Element>(selector:string,timeout=120000):Promise<T|null>{
  const start=performance.now();
  while(performance.now()-start<timeout){
    const el=document.querySelector<T>(selector);
    if(el)return el;
    const error=document.querySelector<HTMLElement>('.app > main .error');
    if(error?.textContent?.trim())throw new Error(error.textContent.trim());
    await sleep(60);
  }
  return null;
}

async function resetMainAnalyzer(){
  const results=document.querySelector<HTMLElement>('.app > main .results');
  if(!results)return;
  const buttons=[...results.querySelectorAll<HTMLButtonElement>('button')];
  const reset=buttons.find(button=>/Nova análise/i.test(button.textContent||''));
  reset?.click();
  await waitFor<HTMLElement>('.app > main .hero',2500);
}

function scrapeAnalysis():ClientAnalysisSnapshot{
  const results=document.querySelector<HTMLElement>('.app > main .results');
  if(!results)throw new Error('O relatório foi processado, mas não foi possível lê-lo na interface.');
  const fields=[...results.querySelectorAll<HTMLElement>('.row')].map(row=>{
    const parts=row.children;
    const label=(parts[0]?.querySelector('b')?.textContent||'Campo').trim();
    const input=parts[1]?.querySelector<HTMLInputElement>('input');
    const value=(input?.value||parts[1]?.textContent||'Não localizado').trim();
    const confidence=(parts[2]?.textContent||'').replace(/\s+/g,' ').trim();
    const source=(parts[3]?.textContent||'').replace(/\s+/g,' ').trim();
    return{label,value,confidence,source};
  });
  const processType=(results.querySelector<HTMLElement>('.metric .type')?.textContent||'NÃO IDENTIFICADO').trim();
  const summary=(results.querySelector<HTMLElement>('.result-head p')?.textContent||'').replace(/\s+/g,' ').trim();
  const found=fields.filter(field=>field.value&&!/Não localizado/i.test(field.value)).length;
  return{processType,summary,found,total:fields.length,fields};
}

export async function runValidatedBase(files:ClientProcessFiles):Promise<ClientAnalysisSnapshot>{
  const {doc,nf,zip}=files;
  if(!zip&&(!doc||!nf))throw new Error('Para este cliente, DOC COMPLETO e NF FISCAL são obrigatórios quando o modo individual for utilizado.');

  await resetMainAnalyzer();

  const inputs=[...document.querySelectorAll<HTMLInputElement>('.app > main input[type="file"]')];
  const pdfInputs=inputs.filter(i=>/application\/pdf/i.test(i.accept));
  const docInput=pdfInputs[0]||inputs[0];
  const nfInput=pdfInputs[1]||inputs[1];
  const zipInput=inputs.find(i=>/zip/i.test(i.accept))||inputs[2];
  if(!docInput||!nfInput||!zipInput)throw new Error('Não foi possível conectar a tela do cliente ao analisador principal.');

  if(zip){
    assignFile(zipInput,zip);
  }else{
    assignFile(docInput,doc!);
    await sleep(0);
    assignFile(nfInput,nf!);
  }

  const analyzeButton=await waitFor<HTMLButtonElement>('.app > main .primary',2500);
  if(!analyzeButton)throw new Error('Botão de análise não localizado.');
  analyzeButton.click();

  const results=await waitFor<HTMLElement>('.app > main .results',120000);
  if(!results)throw new Error('A análise demorou mais do que o esperado para gerar o relatório.');
  return scrapeAnalysis();
}

export async function resetValidatedBase(){
  await resetMainAnalyzer();
}
