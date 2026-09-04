import glovisLogo from './glovis-logo.png';
import { VALIDATED_ANALYSIS_BASE } from './validated-base';

export const GLOVIS_PROFILE=Object.freeze({
  id:'glovis',
  name:'GLOVIS',
  displayName:'Hyundai Glovis',
  logo:glovisLogo,
  analysisBase:VALIDATED_ANALYSIS_BASE.id,
  description:'Utiliza a mesma lógica já validada no fluxo principal para DOC COMPLETO + NF FISCAL e para pacote ZIP.',
  requirements:Object.freeze({
    pairRequiresBoth:true,
    zipEnabled:true
  })
});
