import { defineWorkflowTool, type AgentInput } from "eve/tools";
import { z } from "zod";
import { researchDecisionSchema } from "../../lib/research/autonomy-model";
import { researchContext, applyResearchDecision } from "../lib/research/steps";
export default defineWorkflowTool({
  availableInSubagents: false, execution: "background",
  description: "Internal durable research orchestrator. Only called by the research dispatcher; from chat use autoresearch to add a direction.",
  inputSchema: z.object({ wake_id: z.uuid() }),
  async execute({ wake_id }, ctx) {
    "use workflow";
    const state = await researchContext(ctx, wake_id);
    if (state.prior) return state.prior;
    const decision = researchDecisionSchema.parse(await ctx.agent("research_director", {
      message: JSON.stringify(state.context), outputSchema: z.toJSONSchema(researchDecisionSchema) as NonNullable<AgentInput["outputSchema"]>,
    }));
    return applyResearchDecision(ctx, wake_id, decision);
  },
});
