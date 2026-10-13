import {createHmac} from 'node:crypto';
import {db} from '../db';
import {sealJson,unsealJson} from '../crypto';
import {connectionCatalog,toolConnectionMutation,ToolConnectionError,type ToolConnection,type ConnectionProvider} from './tool-connections';
const fields='id,provider,revision,status,background_access,voice_access,expires_at,created_at,updated_at';
export async function toolConnections(student:string):Promise<ToolConnection[]>{
  const r=await db().from('companion_tool_connections').select(fields).eq('student_id',student).order('provider').limit(10).abortSignal(AbortSignal.timeout(10000));
  // An older deployment has no installations. Never fall back on a shared credential.
  if(r.error&&['42P01','PGRST205'].includes(r.error.code))return [];
  if(r.error)throw new ToolConnectionError('Tool connections unavailable',503);return r.data as ToolConnection[];
}
export async function mutateToolConnection(student:string,input:unknown){
  const p=toolConnectionMutation.parse(input),{token,...metadata}=p;
  const secret=process.env.SESSION_SECRET;if(!secret)throw Error('Credential storage unavailable');
  // A keyed fingerprint compares retries without retaining plaintext credentials in receipts.
  const fingerprint=createHmac('sha256',secret).update(JSON.stringify({student,...p})).digest('hex');
  const sealed=token?sealJson({student,provider:p.provider,token}):null;
  const r=await (p.action==='permissions'
    ?p.voiceAccess!==undefined
      ?db().rpc('companion_connection_voice',{p_student:student,p_provider:p.provider,p_revision:p.revision,p_voice:p.voiceAccess,p_request:p.requestKey,p_fingerprint:fingerprint})
      :db().rpc('companion_connection_background',{p_student:student,p_provider:p.provider,p_revision:p.revision,p_background:p.backgroundAccess!,p_request:p.requestKey,p_fingerprint:fingerprint})
    :db().rpc('companion_manage_tool_connection',{p_student:student,p_input:metadata,p_fingerprint:fingerprint,p_sealed:sealed})).abortSignal(AbortSignal.timeout(10000));
  if(r.error)throw new ToolConnectionError(r.error.code==='P0001'?r.error.message:'Connection receipt unavailable; retry the same operation',r.error.code==='P0001'?409:503);
  return r.data as ToolConnection;
}
export async function activeToolConnection(student:string,connection:ToolConnection){
  const r=await db().from('companion_tool_connections').select('*').eq('student_id',student).eq('id',connection.id).eq('revision',connection.revision).eq('status','active').gt('expires_at',new Date().toISOString()).abortSignal(AbortSignal.timeout(10000)).maybeSingle();
  if(r.error||!r.data||r.data.provider!==connection.provider)throw new ToolConnectionError('Connection changed, expired or disconnected; refresh available connections',403);
  return r.data as ToolConnection&{sealed_token:string|null};
}
export async function toolConnectionToken(student:string,connection:ToolConnection){
  const row=await activeToolConnection(student,connection);
  if(!row.sealed_token)throw Error('Connection credential unavailable');
  const value=unsealJson(row.sealed_token) as {student?:unknown;provider?:unknown;token?:unknown};
  if(value.student!==student||value.provider!==connection.provider||typeof value.token!=='string')throw Error('Connection credential unavailable');
  return {token:value.token};
}
export async function admitConnectionTool(student:string,connection:ToolConnection,tool:string,callId:string){
  if(!(connectionCatalog[connection.provider].tools as readonly string[]).includes(tool))throw new ToolConnectionError('Tool is outside this connection scope',403);
  const r=await db().rpc('companion_admit_connection_call',{p_student:student,p_connection:connection.id,p_revision:connection.revision,p_tool:tool,p_call:callId}).abortSignal(AbortSignal.timeout(10000));
  if(r.error)throw new ToolConnectionError(r.error.code==='P0001'?r.error.message:'Connection authorization unavailable',403);
}
export function providerDefinition(provider:ConnectionProvider){return connectionCatalog[provider];}
export type ResearchConnectionScope={studentId:string;taskId:string;generation:number;execution:string};
export async function researchConnectionScope(studentId:string,taskId:string,generation:number,execution?:string):Promise<ResearchConnectionScope>{
 const r=await db().rpc('companion_connection_task_scope',{p_student:studentId,p_task:taskId,p_generation:generation,p_execution:execution??null}).abortSignal(AbortSignal.timeout(10000));
 if(r.error||typeof r.data!=='string'||!r.data)throw new ToolConnectionError('Research connection access is no longer active',403);
 return {studentId,taskId,generation,execution:r.data};
}
export async function admitResearchConnectionTool(scope:ResearchConnectionScope,connection:ToolConnection,tool:string,callId:string){
 if(!(connectionCatalog[connection.provider].tools as readonly string[]).includes(tool))throw new ToolConnectionError('Tool is outside this connection scope',403);
 const r=await db().rpc('companion_admit_task_connection_call',{p_student:scope.studentId,p_task:scope.taskId,p_generation:scope.generation,p_execution:scope.execution,
  p_connection:connection.id,p_revision:connection.revision,p_tool:tool,p_call:callId}).abortSignal(AbortSignal.timeout(10000));
 if(r.error)throw new ToolConnectionError('Research connection call was not authorized',403);
}
