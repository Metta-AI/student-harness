import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { researchTask } from '../../../lib/tasks/research-access';
import { checkpoint } from '../../../../lib/tasks/store';

export default defineTool({
  description: 'Checkpoint progress, evidence and next step. The human sees this in the background session; saved progress is supplied when the work resumes.',
  inputSchema: z.object({
    summary: z.string().min(1).max(3000).describe("Brief human update: what you learned or are checking and why it matters. No IDs, hashes or tool names; keep them in evidence."),
    evidence: z.array(z.string().max(1000)).max(30),
    nextStep: z.string().max(2000).describe("Next useful action in plain language. Distinguish planned from already running."),
  }),
  async execute(input, ctx) {
    const { task } = await researchTask(ctx);
    await checkpoint(task, task.execution_key!, task.phase, { research_progress: input });
    return { saved: true };
  },
});
