import JSZip from 'jszip';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();

export {};

type Candidate={filename:string;bytes:ArrayBuffer};
type Evidence={value:string;filename:string;page:number;note:string};

async function inputPdfs():Promise<Candidate[]>{
  const out:Candidate[]=[];
  const pdfInput=document.querySelector<HTMLInputElement>('[data-iguasport-file="pdfs"]');
  for(const file of [...(pdfInput?.files||[])])out.push({filename:file.name,bytes:await file.arrayBuffer()});
  const zipFile=document.querySelector<HTMLInputElement>('[data-iguasport-file="zip"]')?.files?.[0];
  if(zipFile){
    const zip=await JSZip.loadAsync(zipFile);
    for(const entry of Object.values(zip.files).filter(e=>!e.dir&&/\.pdf$/i.test(e.name)))out.push({filename:entry.name,bytes:await entry.async('arraybuffer')});
  }
  return out;
}

function carrierName(text:string){
  const explicit=text.match(/\bCARRIER\s*:\s*\[?\s*(CMA\s+CGM|MAERSK\s+A\/S|HAPAG[- ]LLOYD|MSC(?:\s+MEDITERRANEAN\s+SHIPPING\s+COMPANY)?|COSCO(?:\s+SHIPPING)?|EVERGREEN(?:\s+MARINE)?|YANG\s+MING|ZIM(?:\s+INTEGRATED\s+SHIPPING\s+SERVICES)?)/i);
  if(explicit?.[1]){
    const raw=explicit[1];
    if(/CMA\s+CGM/i.test(raw))return'CMA CGM';
    if(/MAERSK\s+A\/S/i.test(raw))return'Maersk A/S';
    if(/HAPAG/i.test(raw))return'Hapag-Lloyd';
    if(/^MSC/i.test(raw))return'MSC';
    if(/COSCO/i.test(raw))return'COSCO Shipping';
    if(/EVERGREEN/i.test(raw))return'Evergreen';
    if(/YANG\s+MING/i.test(raw))return'Yang Ming';
    if(/^ZIM/i.test(raw))return'ZIM';
  }
  const signed=text.match(/SIGNED\s+FOR\s+THE\s+CARRIER\s*:?\s*(CMA\s+CGM|MAERSK\s+A\/S|HAPAG[- ]LLOYD|MSC|COSCO(?:\s+SHIPPING)?|EVERGREEN|YANG\s+MING|ZIM)/i);
  if(signed?.[1]){
    if(/CMA\s+CGM/i.test(signed[1]))return'CMA CGM';
    if(/MAERSK/i.test(signed[1]))return'Maersk A/S';
    return signed[1].trim();
  }
  return'';
}

async function evidence(){
  const files=await inputPdfs();let agency:Evidence|null=null,operation:Evidence|null=null;
  for(const candidate of files){
    try{
      const pdf=await getDocument({data:new Uint8Array(candidate.bytes.slice(0))}).promise;
      for(let n=1;n<=pdf.numPages;n++){
        const page=await pdf.getPage(n),content=await page.getTextContent();
        const text=(content.items as any[]).map(i=>String(i?.str||'')).join(' ').replace(/\s+/g,' ').trim();
        if(!agency){const value=carrierName(text);if(value)agency={value,filename:candidate.filename,page:n,note:/\bCARRIER\s*:/i.test(text)?'CARRIER no BL':'Signed for the Carrier no BL'};}
        if(!operation&&/EXTRATO\s+DA\s+DUIMP|\bDUIMP\b/i.test(text))operation={value:'Importação',filename:candidate.filename,page:n,note:'DUIMP'};
        if(!operation&&/DECLARA[CÇ][AÃ]O\s+ÚNICA\s+DE\s+EXPORTA[CÇ][AÃ]O|\bDUE\b/i.test(text))operation={value:'Exportação',filename:candidate.filename,page:n,note:'DUE'};
      }
    }catch{}
  }
  return{agency,operation};
}

function setRow(label:string,e:Evidence){
  const rows=[...document.querySelectorAll<HTMLElement>('.iguasport-report-view .client-report-row')];
  const row=rows.find(r=>r.querySelector<HTMLElement>('.client-report-field b')?.textContent?.trim()===label);if(!row)return;
  const value=row.querySelector<HTMLElement>('.client-report-value');if(value)value.textContent=e.value;
  const source=`${label==='Agência Marítima'?'BL':e.note} · ${e.filename} · página ${e.page} · ${e.note}`;
  const sourceSpan=row.querySelector<HTMLElement>('.client-report-source-detail > span')||row.querySelector<HTMLElement>('.client-report-field span');if(sourceSpan)sourceSpan.textContent=source;
  row.dataset.iguasportCorrected='true';
}

let applying=false;
async function apply(){
  const report=document.querySelector<HTMLElement>('.iguasport-report-view');if(!report||!report.classList.contains('active')||applying)return;
  if(report.dataset.iguasportEvidenceCorrected==='true')return;
  applying=true;report.dataset.iguasportEvidenceCorrected='true';
  try{const {agency,operation}=await evidence();if(agency)setRow('Agência Marítima',agency);if(operation)setRow('Operação Marítima',operation);}finally{applying=false;}
}

void apply();
const observer=new MutationObserver(mutations=>{
  for(const mutation of mutations){for(const node of mutation.addedNodes){if(!(node instanceof Element))continue;if(node.matches('.iguasport-report-view,.iguasport-report-view *')||node.querySelector('.iguasport-report-view')){void apply();return;}}}
});
observer.observe(document.documentElement,{childList:true,subtree:true});
