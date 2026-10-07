import {defineTool} from 'eve/tools';
import {z} from 'zod';
import {candidateProposalSchema} from '../../../../lib/campaigns/candidate-schema';
import {probeCandidate} from '../../../../lib/campaigns/probe';
import {researchActivity} from '../../../lib/tasks/research-access';

export default defineTool({
 description:'Compile and probe proposed components against an already-audited baseline replay on the dedicated VM. Supply a completed episode-audit or replay-evidence artifact with exact baseline VM verification. Stops at the first world-state divergence; never estimates competitive outcomes or inspects active studies. Returns bounded, tick-stamped BASIC PRINT diagnostics when present (policy-authored, not independent proof of action acceptance). Label instrumented proposals diagnostic-only; require an instrumentation-only baseline to match every hash, then test and separately probe the clean final candidate. Repeat the identical request to poll; do other evidence work while queued. No divergence does not prove no branch activation.',
 inputSchema:z.object({proposal:candidateProposalSchema,baselineEvidenceId:z.uuid()}),
 async execute(input,ctx){
  const {task,token}=await researchActivity(ctx,'Probing candidate against recorded baseline play');
  if(!task.context?.campaignId)throw Error('Candidate diagnostic requires a campaign');
  return probeCandidate(task.student_id,token,task.context.campaignId,task.id,input.proposal,input.baselineEvidenceId);
 },
});
