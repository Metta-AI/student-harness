import { withAuthChallenges, type AuthFn } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { sessionFromCookieHeader } from "../../lib/student-session";
import { teamSession } from "../../lib/team-access";
import {leagueIdSchema,defaultLeagueId} from '../../lib/league-catalog';
import {z} from 'zod';
import {terminalPolicyContextSchema} from '../../lib/terminal/baseline';
import {userPreferences} from '../../lib/preferences-store';
import {controlExtremeGoal,getExtremeGoal} from '../../lib/extreme-research/store';

/** Accept the arena's own encrypted student cookie. Same-origin requests carry it automatically. */
function studentCookie(): AuthFn<Request> {
  return withAuthChallenges(async (request) => {
    const session = await teamSession(sessionFromCookieHeader(request.headers.get("cookie")));
    if (!session) return null;
    // A Stop must revoke future wakes even when credits left no active turn to cancel.
    const control=/\/session\/([^/]+)\/(cancel|reset|clear)$/.exec(new URL(request.url).pathname);
    if(request.method==='POST'&&control){
      const id=decodeURIComponent(control[1]);
      const goal=await getExtremeGoal(session.subjectId,id);
      // The goal control API fences Pause before asking Eve to cancel its turn.
      if(goal&&goal.state!=='paused')await controlExtremeGoal(session.subjectId,id,'stop');
    }
    const body=request.method==='POST'?await request.clone().json().catch(()=>null):null;
    const league=body?.message!==undefined?leagueIdSchema.parse(body?.clientContext?.leagueId??defaultLeagueId):undefined;
    const terminalGrant=z.uuid().safeParse(body?.clientContext?.terminalGrant);
    const agentMode=body?.message!==undefined&&body?.clientContext?.agentMode==='hermes'?'hermes':undefined;
    const terminalPolicyContext=terminalPolicyContextSchema.safeParse(body?.clientContext);
    // Resolve once at the authenticated send boundary. A transient database
    // outage between model steps must not terminate an accepted conversation.
    const preferences=body?.message!==undefined?await userPreferences(session.subjectId):null;
    return {
      authenticator: "student-harness",
      issuer: "softmax",
      principalId: session.subjectId,
      principalType: "user",
      subject: session.subjectId,
      attributes: { email: session.email, ...(league?{leagueId:league}:{}), ...(agentMode?{agentMode}:{}), ...(preferences?{permissionMode:preferences.permissionMode,researchMode:preferences.researchMode,model:preferences.chatModel,effort:preferences.reasoningEffort,modelDefaultsVersion:'1'}:{}), ...(terminalGrant.success?{terminalGrant:terminalGrant.data}:{}), ...(terminalPolicyContext.success?{terminalPolicyContext:JSON.stringify(terminalPolicyContext.data)}:{}) },
    };
  }, [{ scheme: "Bearer" }]);
}

export default eveChannel({
  auth: [studentCookie()],
  turnPolicy: 'steer',
});
