import {defineTool} from 'eve/tools';
import {defineDynamic} from 'eve';
import {z} from 'zod';
import {requireStudent} from '../lib/student';
import {sessionLeague} from '../lib/game-scope';
import {sessionModelSelection} from '../../lib/session-model';
import {gatewayModelIds} from '../../lib/model-selection';
import {runHermesTurn,type HermesTurnResult} from '../../lib/hermes/turn';

/** Hermes mode: the conversation's work runs in Hermes on the account's shared
 * Hermes host. Preston forwards each message here and relays the result. */
export const tool=defineTool({
 availableInSubagents:false,
 description:'Hermes mode only. Send the human’s message (verbatim, plus any receipts of actions you just ran for Hermes) to Hermes, which does the work with its own tools and the harness tools, and return its reply. Call this once per human message. If the result lists pendingApprovals, call each named harness tool yourself with exactly that input (the human approves it the usual way), then call hermes_turn again with the outcome so Hermes can continue.',
 inputSchema:z.strictObject({message:z.string().min(1).max(50000)}),
 label:{start:()=>'Hermes is working'},
 async *execute({message},ctx){
  const student=await requireStudent(ctx);
  const leagueId=sessionLeague(ctx.session.auth);
  const selection=await sessionModelSelection(ctx.session.auth);
  const preface=`[Harness context — not from the human]\nconversation_id: ${ctx.session.id}\nleague_id: ${leagueId}\nPass conversation_id on every harness (preston) tool call. If a harness tool returns approval_required, stop and say what you want to do; the conversation will ask the human and send you the outcome.\n\n`;
  const turn=runHermesTurn({student:student.subjectId,eveSessionId:ctx.session.id,leagueId,title:message.slice(0,80),message:preface+message,model:gatewayModelIds[selection.model],signal:ctx.abortSignal});
  const progress:string[]=[];let next=await turn.next();
  while(!next.done){
   const item=next.value;
   progress.push(item.kind==='tool'?`${item.state} ${item.name}`:item.text.slice(0,200));
   yield {status:'working',progress:progress.slice(-12)};
   next=await turn.next();
  }
  const result:HermesTurnResult=next.value;
  // Eve takes a streaming tool's last yielded value as its output.
  const done={status:'done' as const,reply:result.reply,toolsUsed:[...new Set(result.tools)],pendingApprovals:result.pendingApprovals,hermesSessionId:result.hermesSessionId};
  yield done;
  return done;
 },
});

/** Only offered in Hermes-mode conversations. */
export default defineDynamic({events:{'turn.started':(_event,ctx)=>ctx.session.auth.current?.attributes?.agentMode==='hermes'||ctx.session.auth.initiator?.attributes?.agentMode==='hermes'?tool:null}});
