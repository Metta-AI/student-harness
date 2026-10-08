import { z } from 'zod';

/** Optional for saved results produced before this contract; requested from every new worker. */
export const humanSummarySchema = z.object({
  outcome: z.string().min(1).max(600).describe('What happened or what was learned, in plain language. No hashes or internal IDs.'),
  whyItMatters: z.string().min(1).max(600).describe('Consequence for the policy or confidence in improvement. Preserve uncertainty.'),
  nextStep: z.string().min(1).max(600).describe('Next useful action, with its true status. Do not claim an action is queued without evidence.'),
});
