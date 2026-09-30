import { defineTool } from "eve/tools";
import { z } from "zod";
import { trackServer } from "../../lib/analytics-server";
import { events } from "../../lib/analytics-events";
import { insertExperiment, latestPolicyVersion, listExperiments, markPolicyUploaded, policyVersionByRevision } from "../../lib/db";
import { requestEpisode, uploadPolicy } from "../../lib/softmax";
import { requireStudentToken } from "../lib/student";
import { writeExperiment } from "../lib/workspace";

export default defineTool({
  description: "Start one hosted Gods of the Arena self-play match in the NeuralHub at Diablo Valley College league (ten seats, all this policy) for a saved revision. Uploads the revision first if needed. Games take several minutes; check with hosted_game_status later.",
  inputSchema: z.object({
    revision: z.number().int().positive().optional().describe("Saved revision number. Omit for the latest."),
    title: z.string().min(4).max(50).describe("What this game tests, at most 50 characters."),
    hypothesis: z.string().max(400).optional().describe("The falsifiable expectation for this game."),
  }),
  label: { start: ({ title }) => `Request hosted game: ${title}` },
  async execute({ revision, title, hypothesis }, ctx) {
    const student = await requireStudentToken(ctx);
    const version = revision === undefined ? await latestPolicyVersion(student.subjectId) : await policyVersionByRevision(student.subjectId, revision);
    if (!version) throw new Error("No saved revision to play. Save one with save_policy_version first.");
    let policyVersionId = version.softmax_policy_version_id;
    if (!policyVersionId) {
      const policy = await uploadPolicy(student.token, student.subjectId, version.source, version.summary);
      policyVersionId = policy.id;
      await markPolicyUploaded(version.id, { policyVersionId, label: `${policy.name}:v${policy.version}` });
    }
    const attempt = (await listExperiments(student.subjectId, version.id)).length + 1;
    const experience = await requestEpisode(student.token, policyVersionId, title, `neuralhub-${policyVersionId}-${attempt}`);
    const row = await insertExperiment({ studentId: student.subjectId, policyVersionRowId: version.id, xpRequestId: experience.id, title, hypothesis, status: experience.status });
    await writeExperiment(await ctx.getSandbox(), row);
    await trackServer(student.subjectId, events.hostedGameRequested, { revision: version.revision_number, attempt, xp_request_id: experience.id, has_hypothesis: !!hypothesis });
    return { xp_request_id: experience.id, status: experience.status, revision: version.revision_number, policy_version_id: policyVersionId, note: "Hosted games usually finish within a few minutes. Call hosted_game_status to read results." };
  },
});
