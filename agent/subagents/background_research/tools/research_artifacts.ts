import {defineTool} from 'eve/tools';
import {z} from 'zod';
import {researchActivity} from '../../../lib/tasks/research-access';
import {findArtifacts,readArtifact} from '../../../../lib/campaigns/store';
import {publishClaim,inspectReplay} from '../../../../lib/campaigns/evidence';
import {defaultLeagueId} from '../../../../lib/league-catalog';
import {artifactView} from '../../../../lib/campaigns/artifact-view';
export default defineTool({description:'Search shared research history, read immutable findings, inspect a replay with the pinned native audit worker, or save a claim with exact evidence and falsifier. An observation MUST include episodeId, tickStart (total replay ticks), and action, backed by a completed replay artifact for that episode. Use hypothesis for inferred mechanisms; do not invent a timestamp to save a general finding. Historical evidence is not live league state. Poll a queued replay by repeating the same call; do not wait in a loop.',inputSchema:z.object({
 action:z.enum(['search','read','replay','claim']),query:z.string().max(200).optional(),artifactId:z.uuid().optional(),episodeId:z.string().regex(/^ereq_[a-zA-Z0-9-]+$/).optional(),slot:z.number().int().min(0).max(9).optional(),
 view:z.enum(['summary','timeline','full']).default('summary'),tickStart:z.number().int().nonnegative().optional(),tickEnd:z.number().int().nonnegative().optional(),
 claim:z.object({title:z.string().max(200),claim:z.string().min(1).max(4000),kind:z.enum(['observation','hypothesis','counterexample']),evidenceIds:z.array(z.uuid()).min(1).max(30),episodeId:z.string().optional(),tickStart:z.number().int().nonnegative().optional(),tickEnd:z.number().int().nonnegative().optional(),actor:z.string().optional(),action:z.string().optional(),falsifier:z.string().min(1)}).optional(),
}),async execute(input,ctx){
 const {task,token}=await researchActivity(ctx,`Research evidence · ${input.action}`);const league=task.context?.leagueId??defaultLeagueId;
 if(input.action==='search')return findArtifacts(task.student_id,league,input.query);
 if(input.action==='read'){const row=await readArtifact(task.student_id,z.uuid().parse(input.artifactId));if(row?.league_id!==league)throw Error('Artifact not found');return artifactView(row,input);}
 if(input.action==='replay'){const result=await inspectReplay(task.student_id,token,league,z.string().parse(input.episodeId),input.slot??0,task.context?.campaignId,task.id);return artifactView({id:result.artifactId,artifactId:result.artifactId,kind:'replay-evidence',content:result},input);}
 if(!input.claim)throw Error('Claim is required');return {artifactId:await publishClaim(task.student_id,league,input.claim,task.context?.campaignId,task.id)};
}});
