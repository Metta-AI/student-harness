import {defineTool} from 'eve/tools';
import {z} from 'zod';
import {researchActivity} from '../../../lib/tasks/research-access';
import {findArtifacts,readArtifact} from '../../../../lib/campaigns/store';
import {defaultLeagueId} from '../../../../lib/league-catalog';
import {artifactView} from '../../../../lib/campaigns/artifact-view';

export default defineTool({
 description:'Read exact shared evidence before constructing a candidate. Search prior mechanisms, rejected candidates and counterexamples, then read their complete immutable artifacts. Read-only; no new games or policy changes.',
 inputSchema:z.object({action:z.enum(['search','read']),query:z.string().max(200).optional(),kind:z.string().max(60).optional(),artifactId:z.uuid().optional(),view:z.enum(['summary','timeline','full']).default('summary'),slot:z.number().int().min(0).max(9).optional(),tickStart:z.number().int().nonnegative().optional(),tickEnd:z.number().int().nonnegative().optional()}),
 async execute(input,ctx){
  const {task}=await researchActivity(ctx,`Candidate evidence · ${input.action}`);
  const league=task.context?.leagueId??defaultLeagueId;
  if(input.action==='search')return findArtifacts(task.student_id,league,input.query,input.kind);
  const row=await readArtifact(task.student_id,z.uuid().parse(input.artifactId));
  if(!row||row.league_id!==league)throw Error('Artifact not found');
  return artifactView(row,input);
 },
});
