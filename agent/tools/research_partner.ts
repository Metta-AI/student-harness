import { defineTool } from "eve/tools";
import { z } from "zod";
import { noteInputSchema, planSchema } from "../../lib/research/model";
import { appendNote, proposeExperiment, readResearch } from "../../lib/research/store";
import { requireStudent } from "../lib/student";

export default defineTool({
  availableInSubagents: false,
  description: "Read research cycles, allowance, evidence and current memory; record Preston's position, uncertainty, repair, vocabulary or proposed experiment. Proposals are prioritized and executed by the scheduler only inside an active human-granted allowance. You cannot grant yourself funds, change human commitments, promote a policy, or enter the league. Every experiment needs evidence and a rationale. Use plan mode baseline to test the unchanged active policy before comparison; candidate mode searches for a policy change.",
  inputSchema: z.object({ action: z.enum(["read", "note", "propose"]), note: noteInputSchema.omit({ requestKey: true }).optional(), plan: planSchema.omit({ requestKey: true }).optional() }),
  async execute({ action, note, plan }, ctx) {
    const { subjectId } = requireStudent(ctx);
    const requestKey = `research:${ctx.session.id}:${ctx.callId}`;
    if (action === "read") return readResearch(subjectId);
    if (action === "note" && note) return { id: await appendNote(subjectId, { ...note, requestKey }, "preston") };
    if (action === "propose" && plan) return { id: await proposeExperiment(subjectId, { ...plan, requestKey }, "preston") };
    throw new Error("Provide a note or experiment plan for that action");
  },
});
