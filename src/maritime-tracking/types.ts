export type MaritimeField='carrier'|'bl';
export type TrackingState='unconfigured'|'ready'|'not-found'|'error'|'verified';
export type TrackingResult={
  container:string; carrier:string|null; bl:string|null;
  sourceUrl:string|null; checkedAt:string|null; status:TrackingState;
  message?:string;
};
export type MaritimeTrackingProvider={
  id:string;
  lookup(container:string):Promise<TrackingResult>;
};
export function normalizeContainer(value:string):string|null{
  const normalized=value.toUpperCase().replace(/[^A-Z0-9]/g,'');
  return /^[A-Z]{4}\d{7}$/.test(normalized)?normalized:null;
}
