import { VALIDATED_ANALYSIS_BASE } from './validated-base';

export const GLOVIS_PROFILE=Object.freeze({
  id:'glovis',
  name:'GLOVIS',
  displayName:'Hyundai Glovis',
  logo:`${import.meta.env.BASE_URL}LOGO%20GLOVIS.png`,
  analysisBase:VALIDATED_ANALYSIS_BASE.id,
  description:'Utiliza a mesma lógica já validada no fluxo principal para DOC COMPLETO + NF FISCAL e para pacote ZIP.',
  requirements:Object.freeze({
    pairRequiresBoth:true,
    zipEnabled:true
  })
});
