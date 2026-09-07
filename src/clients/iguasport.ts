export const IGUASPORT_PROFILE=Object.freeze({
  id:'iguasport',
  name:'IGUASPORT',
  displayName:'IGUASPORT',
  logo:`${import.meta.env.BASE_URL}IGUASPORT1.jpeg`,
  analysisBase:'iguasport-v1',
  description:'Cliente com regras próprias de leitura. Aceita vários PDFs avulsos ou um pacote ZIP.',
  requirements:Object.freeze({
    multiplePdfsEnabled:true,
    zipEnabled:true,
    docNfPair:false
  })
});
