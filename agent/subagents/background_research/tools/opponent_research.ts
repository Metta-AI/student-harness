import { defineTool } from 'eve/tools';
import { researchActivity } from '../../../lib/tasks/research-access';
import { opponentToolSchema } from '../../../../lib/opponents/model';
import { opponentResearch } from '../../../../lib/opponents/store';
export default defineTool({description:'List/read/collect opponent evidence, save observations or save_model semantic IR. Collect returns snapshotId directly; cite it with the returned episodes. Collect episodeIds discovered via CLI before citing them. All evidence is scoped to this student and exact league/policy.',inputSchema:opponentToolSchema,async execute(input,ctx){const {task,token}=await researchActivity(ctx,`${input.action === "save_model" ? "Saving semantic model" : input.action === "collect" ? "Collecting episode evidence" : "Reading opponent evidence"}`);return opponentResearch(task.student_id,token,input,'preston',task.context?.leagueId);}});
