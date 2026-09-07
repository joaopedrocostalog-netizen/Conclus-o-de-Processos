export const IGUASPORT_PROFILE=Object.freeze({
  id:'iguasport',
  name:'IGUASPORT',
  displayName:'IGUASPORT',
  logo:'https://raw.githubusercontent.com/joaopedrocostalog-netizen/Conclus-o-de-Processos/main/IGUASPORT.png',
  analysisBase:'iguasport-v1',
  description:'Cliente com regras próprias de leitura. Aceita vários PDFs avulsos ou um pacote ZIP.',
  requirements:Object.freeze({
    multiplePdfsEnabled:true,
    zipEnabled:true,
    docNfPair:false
  })
});
