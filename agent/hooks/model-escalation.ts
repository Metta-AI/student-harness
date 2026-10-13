import {defineHook} from 'eve/hooks';
import {modelEscalationState} from '../lib/model-escalation';

export default defineHook({events:{
 'turn.started'(event){
  modelEscalationState.update(s=>s.turnId===event.data.turnId?s:{struggle:Math.floor(s.struggle/2),turnId:event.data.turnId,actionStep:undefined});
 },
 'actions.requested'(event){
  modelEscalationState.update(s=>({...s,actionStep:event.data.stepIndex}));
 },
 // A step that ends in tool calls but requested no action had every call
 // rejected for invalid input; nothing else reports those.
 'step.completed'(event){
  if(event.data.finishReason!=='tool-calls')return;
  modelEscalationState.update(s=>s.actionStep===event.data.stepIndex?s:{...s,struggle:s.struggle+1});
 },
 'action.result'(event){
  const result=event.data.result;
  if(!('toolName' in result))return;
  if(result.toolName==='goal_completion'){
   const decision=('output' in result?(result.output as {decision?:unknown}|null)?.decision:undefined);
   if(decision==='complete'||decision==='no_goal')modelEscalationState.update(s=>({...s,struggle:0}));
   else if(decision==='continue')modelEscalationState.update(s=>({...s,struggle:s.struggle+2}));
   return;
  }
  if(event.data.status==='failed'||('isError' in result&&result.isError))modelEscalationState.update(s=>({...s,struggle:s.struggle+1}));
 },
}});
