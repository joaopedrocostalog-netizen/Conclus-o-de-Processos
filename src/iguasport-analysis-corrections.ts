import JSZip from 'jszip';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();

export {};

type Candidate={filename:string;bytes:ArrayBuffer};
type Evidence={value:string;filename:string;page:number;note:string};
type PdfItem={str?:string;transform?:number[]};

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

function rowsFromItems(items:PdfItem[]){
  const cells=items.filter(i=>String(i?.str||'').trim()&&i.transform).map(i=>({
    str:String(i.str||'').trim(),x:Number(i.transform?.[4]||0),y:Number(i.transform?.[5]||0)
  }));
  const groups:Array<{y:number;cells:typeof cells}>=[];
  for(const cell of cells){
    let group=groups.find(g=>Math.abs(g.y-cell.y)<=3.5);
    if(!group){group={y:cell.y,cells:[]};groups.push(group)}
    group.cells.push(cell);
  }
  return groups.sort((a,b)=>b.y-a.y).map(g=>g.cells.sort((a,b)=>a.x-b.x).map(c=>c.str).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean);
}

function canonicalCarrier(text:string){
  if(/\bCMA\s*CGM\b/i.test(text))return'CMA CGM';
  if(/\bMAERSK(?:\s+A\/S)?\b/i.test(text))return'Maersk A/S';
  if(/\bHAPAG[- ]LLOYD\b/i.test(text))return'Hapag-Lloyd';
  if(/\bMSC(?:\s+MEDITERRANEAN\s+SHIPPING\s+COMPANY)?\b/i.test(text))return'MSC';
  if(/\bCOSCO(?:\s+SHIPPING)?\b/i.test(text))return'COSCO Shipping';
  if(/\bEVERGREEN(?:\s+MARINE)?\b/i.test(text))return'Evergreen';
  if(/\bYANG\s+MING\b/i.test(text))return'Yang Ming';
  if(/\bZIM(?:\s+INTEGRATED\s+SHIPPING\s+SERVICES)?\b/i.test(text))return'ZIM';
  if(/\bOCEAN\s+NETWORK\s+EXPRESS\b/i.test(text))return'Ocean Network Express';
  return'';
}

function carrierFromPage(rows:string[],flatText:string){
  // 1. Fonte mais forte: bloco visual CARRIER:. Alguns PDFs entregam o nome antes do rótulo
  // na ordem de extração; por isso avaliamos a linha e também a vizinhança imediata.
  for(let i=0;i<rows.length;i++){
    if(!/\bCARRIER\s*:/i.test(rows[i]))continue;
    const neighborhood=rows.slice(Math.max(0,i-2),Math.min(rows.length,i+3)).join(' ');
    const carrier=canonicalCarrier(neighborhood)||canonicalCarrier(flatText);
    if(carrier)return{value:carrier,note:'CARRIER no BL'};
  }

  // 2. Assinatura formal do armador.
  for(const row of rows){
    if(!/SIGNED\s+FOR\s+THE\s+CARRIER/i.test(row))continue;
    const carrier=canonicalCarrier(row);
    if(carrier)return{value:carrier,note:'Signed for the Carrier no BL'};
  }
  const signed=flatText.match(/SIGNED\s+FOR\s+THE\s+CARRIER[\s\S]{0,100}/i)?.[0]||'';
  const signedCarrier=canonicalCarrier(signed);
  if(signedCarrier)return{value:signedCarrier,note:'Signed for the Carrier no BL'};

  // 3. Texto "as agents for the carrier".
  for(const row of rows){
    if(!/AS\s+AGENTS?\s+FOR\s+THE\s+CARRIER/i.test(row))continue;
    const carrier=canonicalCarrier(row);
    if(carrier)return{value:carrier,note:'as agents for the carrier no BL'};
  }

  // 4. Fallback controlado: apenas em página que é claramente conhecimento marítimo.
  const isBl=/BILL OF LADING|B\s*\/\s*L\s*(?:NO|NUMBER)|\bSHIPPER\b.*\bCONSIGNEE\b/i.test(flatText);
  if(isBl){
    const names=['CMA CGM','Maersk A/S','Hapag-Lloyd','MSC','COSCO Shipping','Evergreen','Yang Ming','ZIM','Ocean Network Express'];
    const found=names.filter(name=>{
      if(name==='CMA CGM')return/\bCMA\s*CGM\b/i.test(flatText);
      if(name==='Maersk A/S')return/\bMAERSK(?:\s+A\/S)?\b/i.test(flatText);
      return canonicalCarrier(name)===name&&new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+'),'i').test(flatText);
    });
    if(found.length===1)return{value:found[0],note:'armador identificado no BL'};
    // CMA CGM deve prevalecer quando o próprio BL contém a marca e referências contratuais da CMA.
    if(/\bCMA\s*CGM\b/i.test(flatText)&&/CMA[- ]?CGM\.COM|SOCI[ÉE]T[ÉE]\s+ANONYME|MARSEILLE/i.test(flatText))return{value:'CMA CGM',note:'CMA CGM identificada no BL'};
  }
  return null;
}

async function evidence(){
  const files=await inputPdfs();let agency:Evidence|null=null,operation:Evidence|null=null;
  for(const candidate of files){
    try{
      const pdf=await getDocument({data:new Uint8Array(candidate.bytes.slice(0))}).promise;
      for(let n=1;n<=pdf.numPages;n++){
        const page=await pdf.getPage(n),content=await page.getTextContent(),items=content.items as PdfItem[];
        const rows=rowsFromItems(items);
        const text=items.map(i=>String(i?.str||'')).join(' ').replace(/\s+/g,' ').trim();
        if(!agency){const result=carrierFromPage(rows,text);if(result)agency={value:result.value,filename:candidate.filename,page:n,note:result.note};}
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
  const preview=row.querySelector<HTMLElement>('.client-report-source-preview');
  if(preview){delete preview.dataset.iguasportLoaded;delete preview.dataset.iguasportLoading;preview.replaceChildren();}
}

let applying=false;
async function apply(){
  const report=document.querySelector<HTMLElement>('.iguasport-report-view');if(!report||!report.classList.contains('active')||applying)return;
  if(report.dataset.iguasportEvidenceCorrected==='true')return;
  applying=true;report.dataset.iguasportEvidenceCorrected='true';
  try{const {agency,operation}=await evidence();if(agency)setRow('Agência Marítima',agency);if(operation)setRow('Operação Marítima',operation);}finally{applying=false;}
}

function armForNextAnalysis(){
  const report=document.querySelector<HTMLElement>('.iguasport-report-view');
  if(report)delete report.dataset.iguasportEvidenceCorrected;
}

document.addEventListener('click',event=>{
  const target=event.target;
  if(target instanceof Element&&target.closest('.iguasport-analyze-button'))armForNextAnalysis();
},true);

void apply();
const observer=new MutationObserver(mutations=>{
  for(const mutation of mutations){
    for(const node of mutation.addedNodes){
      if(!(node instanceof Element))continue;
      if(node.matches('.iguasport-report-row,.client-report-row')||node.querySelector('.iguasport-report-view .client-report-row')){void apply();return;}
    }
  }
});
const report=document.querySelector('.iguasport-report-view');
if(report)observer.observe(report,{childList:true,subtree:true});
