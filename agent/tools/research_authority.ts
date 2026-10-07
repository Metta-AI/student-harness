import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { cycleInputSchema, grantSchema, noteInputSchema, evaluationSchema } from "../../lib/research/model";
import { createCycle, grantAllowance, appendNote } from "../../lib/research/store";
import { requireStudent } from "../lib/student";
import { rpc } from "../../lib/tasks/store";

const authorityActionSchema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("record"), note: noteInputSchema.omit({ requestKey: true }) }),
    z.object({ action: z.literal("review"), review: evaluationSchema.omit({ requestKey: true }) }),
    z.object({ action: z.literal("create"), cycle: cycleInputSchema.omit({ requestKey: true }) }),
    z.object({ action: z.literal("grant"), allowance: grantSchema.omit({ requestKey: true }) }),
    z.object({ action: z.literal("control"), cycleId: z.uuid(), control: z.enum(["pause", "resume", "close"]) }),
    z.object({ action: z.literal("select"), cycleId: z.uuid(), versionId: z.uuid(), evaluationId: z.uuid().optional(), reason: z.string().min(5).max(2000) }),
  ]);

export default defineTool({
  availableInSubagents: false,
  description: "Request explicit human approval to create a research cycle, grant or renew its allowance, pause/resume/close it, or select a reviewed policy. Never claim approval before this tool succeeds. Read research_partner first for exact IDs. Grants cap model calls and hosted games; dollars are a reported-spend review threshold, not a billing guarantee. League entry is separate.",
  approval: always(),
  // Emit a provider-compatible object, then validate the selected action's required fields.
  inputSchema: z.object({
    action: z.enum(["record", "review", "create", "grant", "control", "select"]),
    note: noteInputSchema.omit({ requestKey: true }).optional().describe("Required for record."),
    review: evaluationSchema.omit({ requestKey: true }).optional().describe("Required for review."),
    cycle: cycleInputSchema.omit({ requestKey: true }).optional().describe("Required for create."),
    allowance: grantSchema.omit({ requestKey: true }).optional().describe("Required for grant."),
    cycleId: z.uuid().optional().describe("Required for control and select."),
    control: z.enum(["pause", "resume", "close"]).optional().describe("Required for control."),
    versionId: z.uuid().optional().describe("Required for select."),
    evaluationId: z.uuid().optional(),
    reason: z.string().min(5).max(2000).optional().describe("Required for select."),
  }).transform((input, ctx) => {
    const result = authorityActionSchema.safeParse(input);
    if (!result.success) { for (const issue of result.error.issues) ctx.addIssue({code:"custom",message:issue.message,path:issue.path}); return z.NEVER; }
    return result.data;
  }),
  label: { start: input => input.action === "grant" ? `Grant ${input.allowance.modelCalls} model calls and ${input.allowance.hostedGames} hosted games${input.allowance.autonomy ? " · between visits" : " · manual starts"}` : `Research authority: ${input.action}` },
  async execute(input, ctx) {
    const { subjectId } = requireStudent(ctx); const requestKey = `authority:${ctx.session.id}:${ctx.callId}`;
    if (input.action === "record") return { id: await appendNote(subjectId, { ...input.note, requestKey }, "human") };
    if (input.action === "review") {
      const p = input.review;
      return { id: await rpc("research_evaluate", { p_student: subjectId, p_cycle: p.cycleId, p_candidate: p.candidateId,
        p_baseline_xp: p.baselineXp, p_candidate_xp: p.candidateXp, p_finding: p.finding, p_explanation: p.explanation, p_key: requestKey }) };
    }
    if (input.action === "create") return createCycle(subjectId, { ...input.cycle, requestKey });
    if (input.action === "grant") return grantAllowance(subjectId, { ...input.allowance, requestKey });
    if (input.action === "control") return rpc("research_control", { p_student: subjectId, p_cycle: input.cycleId, p_key: requestKey, p_action: input.control });
    return rpc("research_select_policy", { p_student: subjectId, p_cycle: input.cycleId, p_key: requestKey, p_version: input.versionId, p_evaluation: input.evaluationId ?? null, p_reason: input.reason });
  },
});
