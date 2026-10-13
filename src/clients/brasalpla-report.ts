/** Campos do relatório BRASALPLA. Mesmo formato da CEVA, sem compartilhar extração. */
export const BRASALPLA_REPORT_FIELDS=[
  'Cliente','Tipo Documento','Remetente / Exportador','Nº BL / AWB',
  'Local de Armazenagem','Ref. do Cliente','Nº Documento',
  'Destinatário / Importador','Operação Marítima','Agência Marítima',
  'CNPJ do Cliente / Importador','Contêineres','Peso Líquido',
  'Valor Total da Nota'
] as const;
export type BrasalplaFieldLabel=typeof BRASALPLA_REPORT_FIELDS[number];
