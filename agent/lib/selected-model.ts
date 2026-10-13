import {defineDynamic} from 'eve';
import {sessionModelSelection} from '../../lib/session-model';
import {gatewayModelFor} from '../../lib/model-selection';
import {escalationLevel} from './model-escalation';
import {reasoningEfforts} from '../../lib/reasoning';
export const selectedModel=defineDynamic({events:{'step.started':async(_event,ctx)=>{
 const selected=await sessionModelSelection(ctx.session.auth);
 // Eve routes model ID strings through Vercel AI Gateway. Provider helper
 // objects bypass Gateway and charge the direct provider account instead.
 // Auto escalates while the conversation struggles. Its first rung (Haiku)
 // is only competitive on agentic work at high effort or above.
 const level=selected.model==='auto'?escalationLevel():0;
 const effort=selected.model==='auto'&&level===0&&reasoningEfforts.indexOf(selected.effort)<reasoningEfforts.indexOf('high')?'high':selected.effort;
 return {model:gatewayModelFor(selected.model,level),reasoning:effort};
}}});
