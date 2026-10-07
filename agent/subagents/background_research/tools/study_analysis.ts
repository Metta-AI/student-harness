import {defineTool} from 'eve/tools';
import {z} from 'zod';
import {researchActivity} from '../../../lib/tasks/research-access';
import {completedStudyAnalysis} from '../../../../lib/campaigns/study-analysis';
import {defaultLeagueId} from '../../../../lib/league-catalog';

export default defineTool({
 description:'Calculate exact descriptive behavior comparisons across a completed matched study. Returns full-study and hero-class/outcome summaries, paired coverage, and paginated pairs with replay evidence IDs. Use previousStudy.studyId or a terminal learningHistory study ID. Active, reserved, invalid, foreign or incomplete comparisons are unavailable. Command counts are requests, not accepted effects; outcome-selected groups are diagnostic only. Does not launch games or alter any decision.',
 inputSchema:z.object({studyId:z.uuid(),outcome:z.enum(['all','improved','regressed','unchanged']).default('all'),offset:z.number().int().min(0).max(512).default(0),limit:z.number().int().min(1).max(20).default(10)}),
 async execute(input,ctx){
  const {task}=await researchActivity(ctx,'Comparing completed study behavior');
  return completedStudyAnalysis(task.student_id,task.context?.leagueId??defaultLeagueId,input.studyId,input,task.id);
 },
});
