import {defineDynamic} from 'eve';
import {sessionModelSelection} from '../../lib/session-model';
import {gatewayModelIds} from '../../lib/model-selection';
export const selectedModel=defineDynamic({events:{'step.started':async(_event,ctx)=>{
 const selected=await sessionModelSelection(ctx.session.auth);
 // Eve routes model ID strings through Vercel AI Gateway. Provider helper
 // objects bypass Gateway and charge the direct provider account instead.
 return {model:gatewayModelIds[selected.model],reasoning:selected.effort};
}}});
