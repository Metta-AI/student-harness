import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireStudentToken } from '../lib/student';
import { readLiveLeague } from '../../lib/voice/league';
export default defineTool({description:'Fetch the current configured GoTA league, top 10 competitors, all our ranked policies, submissions, measured record and score gap. Use for latest league, are we winning, or how to reach the top. Research cycles and current UI tabs are not league evidence.',inputSchema:z.object({includeRecord:z.boolean().default(false)}),async execute({includeRecord},ctx){const s=await requireStudentToken(ctx);return readLiveLeague(s.subjectId,s.token,includeRecord);}});
