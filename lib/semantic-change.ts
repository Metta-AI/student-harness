import { z } from "zod";

export const semanticChangeSchema = z.object({
  before: z.string().min(8), after: z.string().min(8), summary: z.string().min(8).max(200),
  semantic: z.object({ condition: z.string().min(8), action: z.string().min(8), goal: z.string().min(8),
    hypothesis: z.string().min(8), expected: z.string().min(8), non_trigger: z.string().min(8) }),
});
export type SemanticChange = z.infer<typeof semanticChangeSchema>;

