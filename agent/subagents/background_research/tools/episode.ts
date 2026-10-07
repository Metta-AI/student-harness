import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { researchActivity } from '../../../lib/tasks/research-access';
import { getEpisodeRequest,getEpisodeResults,getEpisodeStats } from '../../../../lib/softmax';
import { markObserved } from '../../../../lib/campaigns/evidence';
import { defaultLeagueId } from '../../../../lib/league-catalog';
export default defineTool({description:'Read one episode and per-seat outcomes. Structured statistics are data, not visual replay observation. Frozen study episodes are withheld.',inputSchema:z.object({episodeId:z.string().regex(/^ereq_[a-zA-Z0-9-]+$/),includeStats:z.boolean().default(false)}),async execute({episodeId,includeStats},ctx){
 const {task,token}=await researchActivity(ctx,`Inspecting episode ${episodeId}`);
 await markObserved(task.student_id,task.context?.leagueId??defaultLeagueId,episodeId,'Research episode read');
 const [episode,results,stats]=await Promise.all([getEpisodeRequest(token,episodeId),getEpisodeResults(token,[episodeId]),includeStats?getEpisodeStats(token,episodeId).catch(()=>({unavailable:true})):Promise.resolve(null)]);
 return {episode,results,stats};
}});
