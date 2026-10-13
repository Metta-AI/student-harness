import {createHash} from 'node:crypto';
import {voiceComputerInput} from './voice-input';
import {listBrowsers} from '../browser/store';
import {browserTransport} from '../browser/transport';
import {assertVoiceActive} from '../voice/session-access';

export async function voiceComputer(student:string,session:string,expires:number,callId:string,raw:unknown){
 const input=voiceComputerInput.parse(raw);
 const active=async()=>{if(Date.now()>=expires)throw Error('Voice session expired');await assertVoiceActive(student,session);};
 await active();let result:unknown;
 if(input.action==='list')result=await listBrowsers(student,'desktop');
 else if(input.action==='state')result=await browserTransport(student,input.computerId,'agent','/state',undefined,undefined,'desktop');
 else if(input.action==='receipt')result=await browserTransport(student,input.computerId,'agent','/receipt',undefined,input.operationId,'desktop');
 else{
  const operationId=createHash('sha256').update(`voice-desktop:${session}:${callId}`).digest('hex');
  try{result={...await browserTransport(student,input.computerId,'agent','/command',{action:'observe',id:operationId,epoch:input.epoch},undefined,'desktop'),computerId:input.computerId,operationId};}
  catch{result={status:'unknown',computerId:input.computerId,operationId,reason:'No observation is confirmed. Inspect state and the operation receipt. Do not claim to see the desktop.'};}
 }
 // Disconnection while capture was in flight must not deliver new pixels.
 await active();return result;
}
