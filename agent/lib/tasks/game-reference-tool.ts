import {defineTool} from 'eve/tools';
import {z} from 'zod';
import {researchActivity} from './research-access';
import {campaignById} from '../../../lib/campaigns/store';
import {gameReference,referenceFiles} from '../../../lib/campaigns/reference';

export default defineTool({
 description:'Inspect exact release-pinned GoTA mechanics and BASIC host implementation. Read hero/item definitions (content), simulation rules (sim), host functions (bots), visibility and object enumeration (observations), map geometry (maps), movement (motions), structured BASIC (structures), scoring (scores), or recorded command meanings (replays). Search a literal symbol or request numbered lines. Use this to resolve unknown mechanics before proposing policy changes.',
 inputSchema:z.object({file:z.enum(referenceFiles),query:z.string().max(160).optional(),startLine:z.number().int().min(1).default(1),maxLines:z.number().int().min(1).max(200).default(100)}),
 async execute(input,ctx){
  const {task}=await researchActivity(ctx,`Reading game source · ${input.file}`);
  if(!task.context?.campaignId)throw Error('A campaign with a pinned game release is required');
  const campaign=await campaignById(task.context.campaignId,task.student_id);
  if(!campaign?.checkpoint.release?.sourceUrl)throw Error('Campaign release is not available');
  return gameReference(campaign.checkpoint.release.sourceUrl,input.file,input.query,input.startLine,input.maxLines);
 },
});
