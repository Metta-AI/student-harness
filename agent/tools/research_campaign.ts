import {defineTool} from 'eve/tools';
import {z} from 'zod';
import {requireStudent} from '../lib/student';
import {campaignInputSchema} from '../../lib/campaigns/model';
import {createCampaign,campaignDetail,controlCampaign,findArtifacts,readArtifact} from '../../lib/campaigns/store';
import {defaultLeagueId} from '../../lib/league-catalog';
export default defineTool({availableInSubagents:false,description:'Start and oversee persistent autoresearch: opponent models, replay evidence, isolated candidate components, matched screening, fresh confirmation and verified league deployment under standing authority. Keeps the human draft untouched. Also retrieve shared artifacts and prior rejected findings. No routine approval required. Return after queuing.',inputSchema:z.object({action:z.enum(['start','status','pause','resume','cancel','artifacts','read_artifact']),campaignId:z.uuid().optional(),artifactId:z.uuid().optional(),query:z.string().max(200).optional(),start:campaignInputSchema.omit({requestKey:true,leagueId:true}).optional()}),async execute(input,ctx){
 const student=requireStudent(ctx);
 if(input.action==='start'){if(!input.start)throw Error('Campaign objective required');const c=await createCampaign(student.subjectId,{...input.start,leagueId:defaultLeagueId,requestKey:`tool:${ctx.session.id}:${ctx.callId}`},ctx.session.id);return {campaignId:c.id,taskId:c.task_id,status:c.state,url:`/sessions/${c.task_id}`};}
 if(input.action==='artifacts')return findArtifacts(student.subjectId,defaultLeagueId,input.query);
 if(input.action==='read_artifact')return readArtifact(student.subjectId,z.uuid().parse(input.artifactId));
 const id=z.uuid().parse(input.campaignId);
 return input.action==='status'?campaignDetail(student.subjectId,id):controlCampaign(student.subjectId,id,input.action);
}});
