import { needsPolicyMerge } from "../../lib/policy-parent";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { trackServer } from "../../lib/analytics-server";
import { events } from "../../lib/analytics-events";
import { insertPolicyVersion, latestPolicyVersion, listExperiments, toRevision } from "../../lib/db";
import { baselineRevision, reconcileSource, semanticFieldsSchema } from "../../lib/semantic-ir";
import { requireStudent } from "../lib/student";
import { commitVersion, starter } from "../lib/workspace";

export default defineTool({
  description: "Record the current /workspace/hero.bas as the student's next saved policy revision. Call after editing the file, or with the unmodified starter when the student has no revisions yet and wants a baseline. Records the semantic intent (condition, action, goal), a falsifiable hypothesis, and links the changed lines to the revision. Does not upload or play.",
  inputSchema: z.object({
    summary: z.string().min(8).max(200).describe("One line, what changed in gameplay terms."),
    semantic: semanticFieldsSchema,
    merged_parent_revision_id: z.string().optional().describe("Only after deliberately merging draft/latest-hero.bas into hero.bas: the latest parent revision ID returned by a stale-workspace error."),
    evidence: z.array(z.string()).max(10).default([]).describe("IDs of coaching sessions, hosted games, or replay notes that motivated the change."),
  }),
  label: { start: ({ summary }) => `Save revision: ${summary}` },
  async execute({ summary, semantic, evidence, merged_parent_revision_id }, ctx) {
    const student = requireStudent(ctx);
    const sandbox = await ctx.getSandbox();
    const source = await sandbox.readTextFile({ path: "hero.bas" });
    if (source === null) throw new Error("/workspace/hero.bas is missing. Restore it from versions/ before saving.");
    const previous = await latestPolicyVersion(student.subjectId);
    const parent = previous ? toRevision(previous) : starter();
    const current = await sandbox.readTextFile({ path: "CURRENT_REVISION.json" });
    const workspaceRevision = current ? z.object({ revisionId: z.string() }).parse(JSON.parse(current)).revisionId : null;
    if (needsPolicyMerge(workspaceRevision, parent.revisionId, merged_parent_revision_id)) {
      await sandbox.writeTextFile({ path: "draft/latest-hero.bas", content: parent.source });
      throw new Error(`Another conversation or background task saved a newer policy. Read draft/latest-hero.bas, deliberately merge it with your hero.bas, then retry with merged_parent_revision_id=${parent.revisionId}. The working copy has not been replaced.`);
    }
    const revision = !previous && source === parent.source
      ? baselineRevision(parent, summary, semantic, evidence)
      : reconcileSource(parent, source, summary, semantic, evidence);
    const row = await insertPolicyVersion({ studentId: student.subjectId, revision, summary, evidence });
    await commitVersion(sandbox, row, await listExperiments(student.subjectId, row.id));
    const rule = revision.ir.strategy.at(-1)!;
    const line = (offset: number) => source.slice(0, offset).split("\n").length;
    const baseline = !previous && source === parent.source;
    await trackServer(student.subjectId, events.policyRevisionSaved, { revision: row.revision_number, baseline, evidence_count: evidence.length, stale_rules: revision.ir.strategy.filter((item) => item.source.status === "stale").length, source_bytes: Buffer.byteLength(source, "utf8") }, { revisions_saved: row.revision_number, last_revision_at: row.created_at });
    return {
      revision: row.revision_number,
      revision_id: row.revision_id,
      summary,
      changed_lines: `${line(rule.source.start)}-${line(Math.max(rule.source.start, rule.source.end - 1))}`,
      stale_rules: revision.ir.strategy.filter((item) => item.source.status === "stale").map((item) => item.id),
      next: "Call upload_policy, then request_hosted_game to test this revision.",
    };
  },
});
