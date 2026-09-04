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

export async function runValidatedBase(files:ClientProcessFiles){
  const {doc,nf,zip}=files;
  if(!zip&&(!doc||!nf))throw new Error('Para este cliente, DOC COMPLETO e NF FISCAL são obrigatórios quando o modo individual for utilizado.');

  const inputs=[...document.querySelectorAll<HTMLInputElement>('.app > main input[type="file"]')];
  const docInput=inputs.find(i=>/application\/pdf/i.test(i.accept))||inputs[0];
  const pdfInputs=inputs.filter(i=>/application\/pdf/i.test(i.accept));
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

  await new Promise(r=>setTimeout(r,30));
  const analyzeButton=document.querySelector<HTMLButtonElement>('.app > main .primary');
  if(!analyzeButton)throw new Error('Botão de análise não localizado.');
  analyzeButton.click();
}
