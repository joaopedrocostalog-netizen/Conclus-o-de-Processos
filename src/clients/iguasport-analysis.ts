export type IguasportInputFiles={
  pdfs:File[];
  zip:File|null;
};

export const IGUASPORT_ANALYSIS_BASE=Object.freeze({
  id:'iguasport-v1',
  client:'IGUASPORT',
  isolated:true
});

// A lógica de extração da IGUASPORT será construída aqui, sem reutilizar ou
// alterar as regras da GLOVIS/validated-base. Este módulo existe justamente
// para manter a análise de cada cliente isolada.
export async function runIguasportAnalysis(_files:IguasportInputFiles):Promise<never>{
  throw new Error('A lógica de análise da IGUASPORT ainda está em configuração.');
}
