import {readReplayFrame,readReplaySequence} from './frames';
import {db} from '../db';
import {replayToolSchema} from './control';
function projected(c:Record<string,unknown>){return {...c,...['queued','delivered'].includes(String(c.status))&&Date.parse(String(c.expires_at))<=Date.now()?{status:c.status==='queued'?'expired':'unknown'}:{}};}
export async function desktopReplay(student:string,input:unknown,key:string){
 const p=replayToolSchema.parse(input);
 if(p.action==='frame')return readReplayFrame(student,p.frameId!);
 if(p.action==='sequence')return readReplaySequence(student,p.frameIds!);
 if(p.action==='request'){
  const r=await db().rpc('desktop_request_command',{p_student:student,p_grant:p.grantId,p_key:key,p_command:p.command});
  if(r.error)throw Error(r.error.message);return projected(r.data);
 }
 if(p.action==='status'){
  const r=await db().from('desktop_commands').select('*').eq('student_id',student).eq('id',p.commandId).maybeSingle();
  if(r.error)throw Error(r.error.message);return r.data?projected(r.data):{error:'Command not found'};
 }
 const r=await db().from('desktop_control_grants').select('id,allow_frames,recording,duration_ms,expires_at,last_seen_at,presence,desktop_devices!inner(name,revoked_at)').eq('student_id',student).is('revoked_at',null).is('desktop_devices.revoked_at',null).gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(10);
 if(r.error)throw Error(r.error.message);return {grants:r.data,provenance:'Client-reported playback state; no footage has been observed.'};
}
