import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import JSZip from 'jszip';

GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();

type Result={value:string;source:string};

type Candidate={filename:string;bytes:ArrayBuffer|Uint8Array};

const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
const weightPattern=/\b\d{1,9}(?:\.\d{3})*,\d{3}\b/g;

async function candidates(nf:File|null,zip:File|null):Promise<Candidate[]>{
  if(nf)return[{filename:nf.name,bytes:await nf.arrayBuffer()}];
  if(!zip)return[];
  const archive=await JSZip.loadAsync(await zip.arrayBuffer());
  const entries=Object.values(archive.files).filter(entry=>!entry.dir&&/\.pdf$/i.test(entry.name));
  return Promise.all(entries.map(async entry=>({filename:entry.name,bytes:await entry.async('uint8array')})));
}

export async function findXcmgNetWeight(nf:File|null,zip:File|null):Promise<Result|null>{
  for(const candidate of await candidates(nf,zip)){
    try{
      const pdf=await getDocument({data:candidate.bytes}).promise;
      for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
        const page=await pdf.getPage(pageNumber);
        const content=await page.getTextContent();
        const pieces=(content.items as any[]).filter(item=>item&&'str' in item).map(item=>String(item.str||'').trim()).filter(Boolean);
        const text=normalize(pieces.join(' '));
        const marker=/PESO\s+BRUTO\s+PESO\s+LIQUIDO/i.exec(text)||/PESO\s+LIQUIDO/i.exec(text);
        if(!marker)continue;
        const window=text.slice(marker.index,marker.index+700);
        const values=[...window.matchAll(weightPattern)].map(match=>match[0]);
        if(values.length){
          const value=values.length>=2?values[1]:values[0];
          return{value,source:`NF · ${candidate.filename} · página ${pageNumber} · PESO LÍQUIDO`};
        }
      }
    }catch{}
  }
  return null;
}
