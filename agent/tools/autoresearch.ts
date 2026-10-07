import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStudent } from "../lib/student";
import { readAutonomy, wakeResearch } from "../../lib/research/autonomy";
import { db } from "../../lib/db";
export default defineTool({
  availableInSubagents: false,
  description: "Start or redirect Preston's autonomous GoTA research without a confirmation card. Preston chooses experiments, evaluates evidence, and selects development candidates within standing workspace limits. Use pause to stop new autonomous work immediately. Never increases resource limits or enters the league.",
  // Providers require an object at the tool-schema root. The pipe preserves action-specific validation.
  inputSchema: z.object({
    action: z.enum(["investigate", "status", "pause"]),
    direction: z.string().min(8).max(2000).optional().describe("Required for investigate; the research direction."),
  }).pipe(z.discriminatedUnion("action", [z.object({ action: z.literal("investigate"), direction: z.string().min(8).max(2000) }), z.object({ action: z.literal("status") }), z.object({ action: z.literal("pause") })])),
  async execute(input, ctx) {
    const { subjectId } = requireStudent(ctx);
    if (input.action === "status") return readAutonomy(subjectId);
    if (input.action === "pause") {
      const { error } = await db().from("research_settings").update({ enabled: false }).eq("student_id", subjectId);
      if (error) throw new Error(error.message);
      return { paused: true, note: "No new autonomous operations will start. Already submitted hosted games may finish." };
    }
    return wakeResearch(subjectId, input.direction, `chat:${ctx.session.id}:${ctx.callId}`);
  },
});
