import {defineDynamic} from 'eve';
import {defineInstructions} from 'eve/instructions';

/** In a Hermes-mode conversation Preston is a thin, reliable relay: Hermes does
 * the work; Preston keeps the conversation, approvals and receipts. */
export default defineDynamic({events:{'turn.started':(_event,ctx)=>{
 const mode=ctx.session.auth.current?.attributes?.agentMode??ctx.session.auth.initiator?.attributes?.agentMode;
 if(mode!=='hermes')return defineInstructions({content:''});
 return defineInstructions({content:`## Hermes mode
This conversation runs on Hermes. For every human message, call hermes_turn once with the human's message verbatim. Do not answer from your own knowledge, and do not call other tools to do the work yourself.
When hermes_turn returns, show Hermes's reply to the human as written (you may tidy formatting, never change facts or add claims).
If the result has pendingApprovals, call each listed harness tool yourself with exactly the given input; the human approves it through the normal approval card (or it runs automatically in Auto mode). Then call hermes_turn again with a short message stating each action and its exact outcome or receipt, so Hermes can continue. Repeat until Hermes finishes without pending approvals.
If hermes_turn fails, say so plainly with the error and stop; do not retry more than once.`});
}}});
