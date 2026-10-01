import { defineTool } from "eve/tools";
import { z } from "zod";
import { trackServer } from "../../lib/analytics-server";
import { events } from "../../lib/analytics-events";
import { latestPolicyVersion, markPolicyUploaded, policyVersionByRevision } from "../../lib/db";
import { resolveStudentPlayer } from "../../lib/player";
import { getPolicyVersionPlayer, uploadPolicy } from "../../lib/softmax";
import { resolvePolicyName } from "../lib/policy-name";
import { requireStudentToken } from "../lib/student";

export default defineTool({
  description: "Upload a saved revision to Softmax as a policy version under the student's account, credited to their default Softmax player (returned as `player`). Idempotent: re-uploading identical source returns the existing version. Defaults to the latest saved revision.",
  inputSchema: z.object({
    revision: z.number().int().positive().optional().describe("Saved revision number. Omit for the latest."),
    policy_name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(35).optional().describe("Student-chosen public policy name, lowercase with words separated by hyphens; a single word is valid. Omit to keep the existing name; on a first upload without a name, the tool derives one from the saved gameplay summary. Pass a new name only when intentionally starting a new version lineage."),
  }),
  label: { start: ({ revision, policy_name }) => `Upload revision ${revision ?? "latest"} to Softmax${policy_name ? ` as ${policy_name}` : ""}` },
  async execute({ revision, policy_name }, ctx) {
    const student = await requireStudentToken(ctx);
    const version = revision === undefined ? await latestPolicyVersion(student.subjectId) : await policyVersionByRevision(student.subjectId, revision);
    if (!version) throw new Error(revision === undefined ? "No saved revision yet. Edit hero.bas and call save_policy_version first." : `Revision ${revision} does not exist.`);
    if (version.softmax_policy_version_id) {
      await trackServer(student.subjectId, events.policyUploaded, { revision: version.revision_number, already_uploaded: true });
      return { revision: version.revision_number, policy_version_id: version.softmax_policy_version_id, policy_label: version.softmax_policy_label, player: version.softmax_player_name, already_uploaded: true };
    }
    const resolved = await resolvePolicyName(student.subjectId, policy_name, version.summary);
    // Uploads are credited to the student's default Softmax player. Read it fresh, name it on the
    // upload, then record what Softmax actually attached to the version.
    const intended = await resolveStudentPlayer(student.subjectId, student.token, { refresh: true });
    const policy = await uploadPolicy(student.token, student.subjectId, version.source, version.summary, resolved.name, intended?.id);
    const label = `${policy.name}:v${policy.version}`;
    const player = (await getPolicyVersionPlayer(student.token, policy.id).catch(() => null)) ?? intended;
    await markPolicyUploaded(version.id, { policyVersionId: policy.id, label, player });
    await trackServer(student.subjectId, events.policyUploaded, { revision: version.revision_number, already_uploaded: false, policy_label: label, renamed: resolved.renamed }, { policies_uploaded_last: label, policy_name: resolved.name });
    return { revision: version.revision_number, policy_version_id: policy.id, policy_label: label, policy_name: resolved.name, player: player?.name ?? null, renamed: resolved.renamed, already_uploaded: false };
  },
});
