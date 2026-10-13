import type {ComputerKind} from './model';

export async function computerResponse(response:Response,kind:ComputerKind,route:string){
 if(response.ok)return response.json();
 if(kind==='desktop'&&route==='/command'&&response.status===409){
  const result=await response.json().catch(()=>null);
  if(result?.status==='rejected'&&result.reason==='stale_observation'&&result.admitted===false){
   return {status:'rejected',admitted:false,reason:'stale_observation',message:'This operation was not admitted because its screenshot expired or changed. Inspect current ownership and obtain a fresh screenshot, then request new owner approval for any input. The previous approval cannot be reused.'};
  }
 }
 // An HTTP error, ownership conflict or missing receipt does not establish
 // whether an earlier attempt with this operation ID already had an effect.
 throw Error(response.status===409?'Computer ownership or observation changed; inspect current state before retrying':'Computer operation could not be accepted');
}
