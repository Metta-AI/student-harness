import {db} from '../db';
import type {EvidenceRecord} from '../companion/evidence';

/** This is observed state, never an authorization for executing a command. */
export async function desktopEvidenceState(student:string,row:EvidenceRecord,signal:AbortSignal){
 const grantId=row.payload.grantId,commandId=row.payload.commandId;
 const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
 if(!uuid(grantId))return {historical:true,grant:null,command:null};
 const client=db();
 const grant=await client.from('desktop_control_grants').select('id,revoked_at,expires_at,desktop_devices!inner(revoked_at)')
  .eq('student_id',student).eq('id',grantId).limit(1).abortSignal(signal).maybeSingle();
 if(grant.error)throw Error('Desktop evidence freshness unavailable; retry this same source');
 const device=Array.isArray(grant.data?.desktop_devices)?grant.data.desktop_devices[0]:grant.data?.desktop_devices;
 let state:{id:string;status:string;expiresAt:string|null}|null=grant.data?{id:grantId,status:grant.data.revoked_at||device?.revoked_at?'revoked':Date.parse(grant.data.expires_at)<=Date.now()?'expired':'granted',expiresAt:grant.data.expires_at}:null;
 if(!state){
  const stopped=await client.from('desktop_control_revocations').select('grant_id').eq('student_id',student).eq('grant_id',grantId).limit(1).abortSignal(signal).maybeSingle();
  if(stopped.error)throw Error('Desktop stop evidence unavailable; retry this same source');
  if(stopped.data)state={id:grantId,status:'revoked',expiresAt:null};
 }
 if(row.kind==='desktop.control')return {historical:!state||state.status!==row.payload.status,grant:state,command:null};
 if(!uuid(commandId))return {historical:true,grant:state,command:null};
 const command=await client.from('desktop_commands').select('id,status,receipt,expires_at')
  .eq('student_id',student).eq('grant_id',grantId).eq('id',commandId).limit(1).abortSignal(signal).maybeSingle();
 if(command.error)throw Error('Desktop command freshness unavailable; retry this same source');
 const c=command.data;
 const status=c&&['queued','delivered'].includes(c.status)&&Date.parse(c.expires_at)<=Date.now()?(c.status==='queued'?'expired':'unknown'):c?.status;
 const current=c?{id:c.id,status,acknowledged:typeof c.receipt?.status==='string'}:null;
 return {historical:!current||current.status!==row.payload.status||current.acknowledged!==row.payload.acknowledged,grant:state,command:current};
}

export async function expireDesktopControls(){
 const result=await db().rpc('desktop_expire_controls',{p_limit:100}).abortSignal(AbortSignal.timeout(10000));
 if(result.error)throw Error('Desktop control expiry unavailable');return result.data;
}
