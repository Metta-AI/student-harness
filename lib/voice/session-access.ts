import {db} from '../db';
export async function assertVoiceActive(student:string,session:string){
 const r=await db().rpc('companion_voice_active',{p_student:student,p_session:session}).abortSignal(AbortSignal.timeout(5000));
 if(r.error||r.data!==true)throw Error('Voice session is no longer active');
}
