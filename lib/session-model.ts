import type {SessionAuth} from 'eve/context';
import {db} from './db';
import {userPreferences} from './preferences-store';
import {modelSelectionSchema,defaultChatModel,type ModelSelection} from './model-selection';
import {defaultReasoningEffort} from './reasoning';
/** Background work retains its creation-time selection; chat uses the saved composer selection. */
export async function sessionModelSelection(auth:SessionAuth):Promise<ModelSelection>{
 const task=auth.initiator?.authenticator==='task-runner'?auth.initiator:null;
 if(task){
  // Only the internal scheduler issues task-runner auth. Persist its immutable
  // selection with the session so a database outage cannot change/stop its model.
  if(task.attributes.model!==undefined||task.attributes.effort!==undefined)
   return modelSelectionSchema.parse({model:task.attributes.model,effort:task.attributes.effort});
  // Existing sessions predate the snapshot. Retry transient reads, never silently
  // substitute another model or leak upstream HTML/credentials into the UI.
  for(let attempt=0;attempt<3;attempt++){
   const {data,error}=await db().from('agent_tasks').select('model_selection').eq('id',task.attributes.taskId).eq('student_id',task.principalId).abortSignal(AbortSignal.timeout(5000)).single();
   if(!error&&data)return modelSelectionSchema.parse(data.model_selection);
   if(!error||['PGRST116','42501'].includes(error.code??''))break;
   if(attempt<2)await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
  }
  throw Error('Could not load session model selection; the saved model is unchanged. Retrying requires database access.');
 }
 const principal=auth.current??auth.initiator;
 if(principal&&['student-harness','research-orchestrator'].includes(principal.authenticator)){
  const p=await userPreferences(principal.principalId);return {model:p.chatModel,effort:p.reasoningEffort};
 }
 return {model:defaultChatModel,effort:defaultReasoningEffort};
}
