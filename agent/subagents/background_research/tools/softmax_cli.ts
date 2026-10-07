import { db } from '../../../../lib/db';
import { markObserved } from '../../../../lib/campaigns/evidence';
import { defaultLeagueId } from '../../../../lib/league-catalog';
import { defineTool } from 'eve/tools';
import { researchActivity } from '../../../lib/tasks/research-access';
import { softmaxCliSchema,runSoftmaxCli } from '../../../../lib/voice/cli';
export default defineTool({description:'Read current Softmax league, division, membership, policy, episode, docs or hosted results via the CLI. Read operations only. Prefer --json. For one league use program=coworld args=["leagues", "league_ID", "--json"]; use ["episodes", "--help"] to discover episode filters. Run serially.',inputSchema:softmaxCliSchema,async execute(input,ctx){const {task,token}=await researchActivity(ctx,`Reading ${input.program} ${input.args.slice(0,2).join(" ")}`);const league=task.context?.leagueId??defaultLeagueId;
const help=input.args.includes('--help')||input.args.includes('-h');
if(!help){
 const reserved=await db().from('research_studies').select('id').eq('student_id',task.student_id).in('state',['running','auditing']).limit(1);
 if(reserved.error)throw Error('Could not verify held-out study protection');
 if(reserved.data?.length)throw Error('A frozen comparison is active. Use the episode and research_artifacts tools for scoped evidence; broad CLI reads are withheld until it finishes.');
}
const result=await runSoftmaxCli(token,input);
const episodes=[...new Set(result.stdout.match(/ereq_[a-zA-Z0-9-]+/g)??[])];
for(const id of episodes)await markObserved(task.student_id,league,id,'Research CLI read');
return result;}});
