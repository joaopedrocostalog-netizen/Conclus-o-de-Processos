export const XCMG_PROFILE=Object.freeze({
  id:'xcmg',
  name:'XCMG',
  displayName:'XCMG',
  logo:'https://raw.githubusercontent.com/joaopedrocostalog-netizen/Conclus-o-de-Processos/main/XCMG%20LOGO.png',
  analysisBase:'xcmg-v1',
  description:'Cliente com base própria de leitura. A planilha é obrigatória e deve ser enviada junto com a NF Fiscal ou com o pacote ZIP.',
  requirements:Object.freeze({
    spreadsheetRequired:true,
    spreadsheetEnabled:true,
    nfEnabled:true,
    zipEnabled:true,
    nfOrZipRequired:true,
    nfZipMutuallyExclusive:true
  })
});
