import {normalizeContainer,type MaritimeTrackingProvider,type TrackingResult} from './types';
/** Adapter boundary for the existing Costalog eTracking API.
 * No endpoint, token or response structure is assumed until its contract is known.
 */
let activeProvider:MaritimeTrackingProvider|null=null;
export function registerMaritimeProvider(provider:MaritimeTrackingProvider|null):void{
  activeProvider=provider;
}
export function isMaritimeProviderConfigured():boolean{return activeProvider!==null;}
export async function lookupMaritimeContainer(raw:string):Promise<TrackingResult>{
  const container=normalizeContainer(raw);
  if(!container)return{container:raw,carrier:null,bl:null,sourceUrl:null,checkedAt:null,status:'error',message:'Número de contêiner inválido.'};
  if(!activeProvider)return{container,carrier:null,bl:null,sourceUrl:null,checkedAt:null,status:'unconfigured',message:'Aguardando configuração da API do eTracking Costa Log.'};
  try{return await activeProvider.lookup(container);}
  catch{return{container,carrier:null,bl:null,sourceUrl:null,checkedAt:new Date().toISOString(),status:'error',message:'Consulta indisponível. Os dados dos documentos foram preservados.'};}
}
