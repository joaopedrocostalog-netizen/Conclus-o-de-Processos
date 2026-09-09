export type IguasportInputFiles={
  pdfs:File[];
  zip:File|null;
};

export const IGUASPORT_REPORT_FIELDS=Object.freeze([
  'Cliente',
  'Tipo Documento',
  'Remetente / Exportador',
  'Nº BL / AWB',
  'Local de Armazenagem',
  'Ref. do Cliente',
  'Nº Documento',
  'Destinatário / Importador',
  'Operação Marítima',
  'Agência Marítima',
  'CNPJ do Cliente / Importador',
  'Contêineres',
  'Peso Líquido',
  'Valor Total da Nota'
] as const);

export type IguasportReportFieldLabel=typeof IGUASPORT_REPORT_FIELDS[number];

export type IguasportAnalysisField={
  label:IguasportReportFieldLabel;
  value:string;
  source:string;
  confidence:string;
};

export type IguasportAnalysisSnapshot={
  client:'IGUASPORT';
  processType:string;
  summary:string;
  fields:IguasportAnalysisField[];
  found:number;
  total:number;
};

export const IGUASPORT_ANALYSIS_BASE=Object.freeze({
  id:'iguasport-v1',
  client:'IGUASPORT',
  isolated:true,
  reportFields:IGUASPORT_REPORT_FIELDS
});

// Toda a extração da IGUASPORT será construída exclusivamente neste módulo
// (e em futuros módulos dentro de clients/iguasport/), sem importar, reutilizar
// ou alterar as regras da GLOVIS/validated-base.
//
// A Agência Marítima é um campo exclusivo deste relatório e já faz parte do
// schema da IGUASPORT. As regras de onde localizar cada informação serão
// adicionadas conforme os documentos reais deste cliente forem validados.
export async function runIguasportAnalysis(_files:IguasportInputFiles):Promise<IguasportAnalysisSnapshot>{
  throw new Error('A lógica de análise da IGUASPORT ainda está em configuração.');
}
