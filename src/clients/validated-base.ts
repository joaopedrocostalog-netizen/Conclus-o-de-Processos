export type ClientProcessFiles={doc:File|null;nf:File|null;zip:File|null};

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

async function waitForAnalyzeButton(timeout=1200){
  const start=performance.now();
  while(performance.now()-start<timeout){
    const button=document.querySelector<HTMLButtonElement>('.app > main .primary');
    if(button)return button;
    await new Promise(r=>setTimeout(r,30));
  }
  return null;
}

export async function runValidatedBase(files:ClientProcessFiles){
  const {doc,nf,zip}=files;
  if(!zip&&(!doc||!nf))throw new Error('Para este cliente, DOC COMPLETO e NF FISCAL são obrigatórios quando o modo individual for utilizado.');

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
    await new Promise(r=>setTimeout(r,0));
    assignFile(nfInput,nf!);
  }

  const analyzeButton=await waitForAnalyzeButton();
  if(!analyzeButton)throw new Error('Botão de análise não localizado.');
  analyzeButton.click();
}
