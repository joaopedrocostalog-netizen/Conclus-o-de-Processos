import { getDocument } from 'pdfjs-dist';

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
const one=(value:string)=>value.replace(/\s+/g,' ').trim();
const invalidValue=(value:string)=>!value||/Não localizado/i.test(value);

const zipAnalysisCache=new WeakMap<File,Promise<ClientAnalysisSnapshot>>();
const pairAnalysisCache=new WeakMap<File,WeakMap<File,Promise<ClientAnalysisSnapshot>>>();
const recoveredClientCache=new WeakMap<File,Promise<{value:string;source:string}|null>>();

function cloneSnapshot(snapshot:ClientAnalysisSnapshot):ClientAnalysisSnapshot{
  return{
    ...snapshot,
    fields:snapshot.fields.map(field=>({...field}))
  };
}

function cachedAnalysis(files:ClientProcessFiles){
  if(files.zip)return zipAnalysisCache.get(files.zip)||null;
  if(files.doc&&files.nf)return pairAnalysisCache.get(files.doc)?.get(files.nf)||null;
  return null;
}

function cacheAnalysis(files:ClientProcessFiles,promise:Promise<ClientAnalysisSnapshot>){
  if(files.zip){
    zipAnalysisCache.set(files.zip,promise);
    promise.catch(()=>{if(zipAnalysisCache.get(files.zip!)===promise)zipAnalysisCache.delete(files.zip!)});
    return;
  }
  if(files.doc&&files.nf){
    let nfMap=pairAnalysisCache.get(files.doc);
    if(!nfMap){nfMap=new WeakMap<File,Promise<ClientAnalysisSnapshot>>();pairAnalysisCache.set(files.doc,nfMap)}
    nfMap.set(files.nf,promise);
    promise.catch(()=>{if(nfMap?.get(files.nf!)===promise)nfMap?.delete(files.nf!)});
  }
}

async function waitFor<T extends Element>(selector:string,timeout=120000):Promise<T|null>{
  const immediate=document.querySelector<T>(selector);
  if(immediate)return immediate;

  return new Promise<T|null>((resolve,reject)=>{
    let settled=false;
    const finish=(value:T|null,error?:Error)=>{
      if(settled)return;
      settled=true;
      observer.disconnect();
      clearTimeout(timer);
      error?reject(error):resolve(value);
    };
    const inspect=()=>{
      const el=document.querySelector<T>(selector);
      if(el){finish(el);return}
      const error=document.querySelector<HTMLElement>('.app > main .error');
      if(error?.textContent?.trim())finish(null,new Error(error.textContent.trim()));
    };
    const observer=new MutationObserver(inspect);
    observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','disabled']});
    const timer=window.setTimeout(()=>finish(null),timeout);
    inspect();
  });
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
  const found=fields.filter(field=>!invalidValue(field.value)).length;
  return{processType,summary,found,total:fields.length,fields};
}

type PdfCell={str:string;x:number;y:number;w:number;h:number};

function cellFromItem(raw:any):PdfCell|null{
  const str=String(raw?.str||'').trim();
  const t=raw?.transform;
  if(!str||!Array.isArray(t))return null;
  return{str,x:Number(t[4]||0),y:Number(t[5]||0),w:Number(raw?.width||0),h:Number(raw?.height||0)};
}

function cleanCompany(value:string){
  return one(value)
    .replace(/^RAZ[AÃ]O\s+SOCIAL\s*/i,'')
    .replace(/\s+(CNPJ\s*\/\s*CPF|CNPJ|ENDERE[CÇ]O|FRETE\s+POR\s+CONTA).*$/i,'')
    .trim();
}

async function recoverClientFromTransporter(nf:File):Promise<{value:string;source:string}|null>{
  const cached=recoveredClientCache.get(nf);
  if(cached)return cached;

  const task=(async()=>{
    try{
      const pdf=await getDocument({data:new Uint8Array(await nf.arrayBuffer())}).promise;
      if(pdf.numPages<1)return null;
      const page=await pdf.getPage(1);
      const content=await page.getTextContent();
      const cells=(content.items as any[]).map(cellFromItem).filter(Boolean) as PdfCell[];
      const text=cells.map(cell=>cell.str).join('\n');

      const header=cells.find(cell=>/TRANSPORTADOR\s*\/\s*VOLUMES\s*TRANSPORTADOS/i.test(cell.str));
      const labels=cells.filter(cell=>/^RAZ[AÃ]O\s+SOCIAL$/i.test(cell.str.trim()));
      for(const label of labels){
        if(header&&!(label.y<header.y&&label.y>header.y-80))continue;
        const freight=cells
          .filter(cell=>/^FRETE\s+POR\s+CONTA$/i.test(cell.str.trim())&&Math.abs(cell.y-label.y)<12&&cell.x>label.x)
          .sort((a,b)=>a.x-b.x)[0];
        const maxX=freight?freight.x-2:label.x+320;
        const candidates=cells
          .filter(cell=>cell.y<label.y-1&&cell.y>label.y-42&&cell.x>=label.x-5&&cell.x<maxX)
          .filter(cell=>!/RAZ[AÃ]O|FRETE|CNPJ|ENDERE[CÇ]O|QUANTIDADE|ESP[EÉ]CIE|MARCA|NUMERA[CÇ][AÃ]O|PESO/i.test(cell.str))
          .sort((a,b)=>b.y-a.y||a.x-b.x);
        if(candidates.length){
          const sameLineY=candidates[0].y;
          const company=cleanCompany(candidates.filter(cell=>Math.abs(cell.y-sameLineY)<4).map(cell=>cell.str).join(' '));
          if(company.length>3&&!/DESTINAT[AÁ]RIO|REMETENTE|HYUNDAI\s+GLOVIS\s+CO/i.test(company)){
            return{value:company,source:`NF FISCAL · ${nf.name} · página 1: ${company} · Transportador / Razão Social`};
          }
          if(company.length>3&&!/DESTINAT[AÁ]RIO|REMETENTE/i.test(company)){
            return{value:company,source:`NF FISCAL · ${nf.name} · página 1: ${company} · Transportador / Razão Social`};
          }
        }
      }

      const transportStart=text.search(/TRANSPORTADOR\s*\/\s*VOLUMES\s*TRANSPORTADOS/i);
      if(transportStart>=0){
        const block=text.slice(transportStart,transportStart+1800);
        const patterns=[
          /(?:^|\n)\s*([^\n]{2,100}?)\s+1\s*-\s*Dest\s*\/\s*Rem(?:\s+|$)/i,
          /RAZ[AÃ]O\s+SOCIAL\s*\n\s*([^\n]{3,100})/i
        ];
        for(const pattern of patterns){
          const match=block.match(pattern);
          const company=match?.[1]?cleanCompany(match[1]):'';
          if(company.length>3&&!/FRETE\s+POR\s+CONTA|C[ÓO]DIGO\s+ANTT|PLACA\s+DO\s+VE[IÍ]CULO|CNPJ/i.test(company)){
            return{value:company,source:`NF FISCAL · ${nf.name} · página 1: ${company} · Transportador / Razão Social`};
          }
        }
      }
    }catch{}
    return null;
  })();

  recoveredClientCache.set(nf,task);
  return task;
}

async function repairManualPairSnapshot(snapshot:ClientAnalysisSnapshot,files:ClientProcessFiles){
  if(files.zip||!files.doc||!files.nf)return snapshot;
  const client=snapshot.fields.find(field=>/^Cliente$/i.test(field.label));
  if(client&&invalidValue(client.value)){
    const recovered=await recoverClientFromTransporter(files.nf);
    if(recovered){
      client.value=recovered.value;
      client.confidence='✓ Alta confiança';
      client.source=recovered.source;
    }
  }
  snapshot.found=snapshot.fields.filter(field=>!invalidValue(field.value)).length;
  return snapshot;
}

async function executeValidatedBase(files:ClientProcessFiles):Promise<ClientAnalysisSnapshot>{
  const {doc,nf,zip}=files;

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

  // Aguarda o React terminar de registrar os arquivos no analisador oculto.
  // Antes, o botão .primary podia ser encontrado ainda desabilitado; o click era ignorado
  // e a ponte ficava aguardando o relatório até estourar o timeout de 120 segundos.
  await sleep(20);
  const analyzeButton=await waitFor<HTMLButtonElement>('.app > main .primary:not(:disabled)',5000);
  if(!analyzeButton)throw new Error('Os documentos foram carregados, mas o analisador não ficou pronto para iniciar. Tente selecionar os arquivos novamente.');
  analyzeButton.click();

  const results=await waitFor<HTMLElement>('.app > main .results',120000);
  if(!results)throw new Error('A análise demorou mais do que o esperado para gerar o relatório.');
  return repairManualPairSnapshot(scrapeAnalysis(),files);
}

export async function runValidatedBase(files:ClientProcessFiles):Promise<ClientAnalysisSnapshot>{
  const {doc,nf,zip}=files;
  if(!zip&&(!doc||!nf))throw new Error('Para este cliente, DOC COMPLETO e NF FISCAL são obrigatórios quando o modo individual for utilizado.');

  const cached=cachedAnalysis(files);
  if(cached)return cloneSnapshot(await cached);

  const task=executeValidatedBase(files).then(snapshot=>cloneSnapshot(snapshot));
  cacheAnalysis(files,task);
  return cloneSnapshot(await task);
}

export async function resetValidatedBase(){
  await resetMainAnalyzer();
}
