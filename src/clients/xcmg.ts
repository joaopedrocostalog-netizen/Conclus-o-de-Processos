export const XCMG_PROFILE=Object.freeze({
  id:'xcmg',
  name:'XCMG',
  displayName:'XCMG',
  logo:'https://raw.githubusercontent.com/joaopedrocostalog-netizen/Conclus-o-de-Processos/main/XCMG%20LOGO.png',
  analysisBase:'xcmg-v1',
  description:'Cliente com base própria de leitura. Aceita NF Fiscal em PDF ou um pacote ZIP.',
  requirements:Object.freeze({
    nfEnabled:true,
    zipEnabled:true,
    mutuallyExclusive:true
  })
});
