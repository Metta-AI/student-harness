export async function campaignContext(taskId:string,execution:string){
 'use step';
 const {taskById}=await import('../../../lib/tasks/store');
 const {assertExecution}=await import('../../../lib/tasks/model');
 const {campaignById,findArtifacts,readArtifact}=await import('../../../lib/campaigns/store');
 const {previousStudyFeedback}=await import('../../../lib/campaigns/feedback');
 const {campaignLearningHistory}=await import('../../../lib/campaigns/learning-history');
 const task=await taskById(taskId);if(!task)throw Error('Task missing');assertExecution(task,execution);
 const c=task.context?.campaignId?await campaignById(task.context.campaignId,task.student_id):null;
 if(!c||c.state!=='active')throw Error('Campaign is not active');
 const records=await findArtifacts(task.student_id,c.league_id,'',undefined,30);
 const evidence=await Promise.all((c.checkpoint.evidenceIds??[]).map((id:string)=>readArtifact(task.student_id,id)));
 const legends=await findArtifacts(task.student_id,c.league_id,'','release-semantics',10);
 const definitions=await Promise.all((legends??[]).map(row=>readArtifact(task.student_id,row.id)));
 const replaySemantics=definitions.find(row=>row?.content?.release?.fingerprint===c.checkpoint.release?.fingerprint)?.content;
 return {cycleNumber:c.cycle+1,cycleNaming:'Use cycleNumber in human-facing titles and findings; cycle is a zero-based storage index. Cite study IDs to disambiguate older artifacts with zero-based titles.',objective:c.objective,direction:c.checkpoint.direction,baseline:c.checkpoint.baselines?.[0],release:c.checkpoint.release,
   evidence,reusedResearchTaskIds:c.checkpoint.reusedResearchTasks??[],replaySemantics,knownArtifacts:records,learningHistory:await campaignLearningHistory(c),lastResult:c.checkpoint.lastResult,previousStudy:await previousStudyFeedback(c),rejectedCandidate:c.checkpoint.rejectedCandidate,validationError:c.checkpoint.validationError,
   evaluationDesign:c.protocol.fixtureMode==='fresh-seeds'?'Fresh random seeds on recorded league lineups/settings, balanced across all ten subject seats. Both arms react normally. These are not historical episode replays. Previously observed/reserved seeds are excluded; both cohorts are frozen before outcomes.':'Fresh metadata-selected fixtures balance all ten subject seats across both teams. Observed mechanism examples remain excluded from independent confirmation.',
   evaluationProtocol:c.protocol,
   metric:'The pinned GoTA league ranks team placements with OpenSkill and displays conservative MMR (mu - 3*sigma). Team win/draw/loss utility is our comparison proxy, not an exact prediction of rating change. XP and Glory are secondary diagnostics; a larger winning score margin alone does not improve the placement.',
   goal:task.objective};
}
export async function adoptCampaign(taskId:string,execution:string,confirmationPairs=64){
 'use step';
 const {taskById}=await import('../../../lib/tasks/store');
 const {assertExecution}=await import('../../../lib/tasks/model');
 const {createCampaign}=await import('../../../lib/campaigns/store');
 const {defaultLeagueId}=await import('../../../lib/league-catalog');
 const task=await taskById(taskId);if(!task)throw Error('Task missing');assertExecution(task,execution);
 const c=await createCampaign(task.student_id,{objective:task.objective,leagueId:task.context?.leagueId??defaultLeagueId,
  requestKey:`session:${task.id}`,protocol:{confirmationPairs}},undefined,task.id);
 // Inserting the campaign atomically parks its root session through campaign_session_sync.
 return taskById(c.task_id,task.student_id);
}
