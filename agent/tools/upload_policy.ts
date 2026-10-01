import { defineTool } from "eve/tools";
import { z } from "zod";
import { trackServer } from "../../lib/analytics-server";
import { events } from "../../lib/analytics-events";
import { latestPolicyVersion, markPolicyUploaded, policyVersionByRevision } from "../../lib/db";
import { uploadPolicy } from "../../lib/softmax";
import { resolvePolicyName } from "../lib/policy-name";
import { requireStudentToken } from "../lib/student";

export default defineTool({
  description: "Upload a saved revision to Softmax as a policy version under the student's account. Idempotent: re-uploading identical source returns the existing version. Defaults to the latest saved revision.",
  inputSchema: z.object({
    revision: z.number().int().positive().optional().describe("Saved revision number. Omit for the latest."),
    policy_name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+){1,4}$/).max(40).optional().describe("Kebab-case name of two to five words that captures how this policy plays, such as tower-rush-berserker or patient-kiting-ranger. Required for the student's first upload. Omit on later uploads to keep the name; pass a new one only when the strategy's identity has changed, which starts a new version lineage. Never include the student's name or email."),
  }),
  label: { start: ({ revision, policy_name }) => `Upload revision ${revision ?? "latest"} to Softmax${policy_name ? ` as ${policy_name}` : ""}` },
  async execute({ revision, policy_name }, ctx) {
    const student = await requireStudentToken(ctx);
    const version = revision === undefined ? await latestPolicyVersion(student.subjectId) : await policyVersionByRevision(student.subjectId, revision);
    if (!version) throw new Error(revision === undefined ? "No saved revision yet. Edit hero.bas and call save_policy_version first." : `Revision ${revision} does not exist.`);
    if (version.softmax_policy_version_id) {
      await trackServer(student.subjectId, events.policyUploaded, { revision: version.revision_number, already_uploaded: true });
      return { revision: version.revision_number, policy_version_id: version.softmax_policy_version_id, policy_label: version.softmax_policy_label, already_uploaded: true };
    }
    const resolved = await resolvePolicyName(student.subjectId, policy_name);
    if (!resolved) throw new Error("This student's policy has no name yet. Call upload_policy again with policy_name: two to five kebab-case words describing how the policy plays.");
    const policy = await uploadPolicy(student.token, student.subjectId, version.source, version.summary, resolved.name);
    const label = `${policy.name}:v${policy.version}`;
    await markPolicyUploaded(version.id, { policyVersionId: policy.id, label });
    await trackServer(student.subjectId, events.policyUploaded, { revision: version.revision_number, already_uploaded: false, policy_label: label, renamed: resolved.renamed }, { policies_uploaded_last: label, policy_name: resolved.name });
    return { revision: version.revision_number, policy_version_id: policy.id, policy_label: label, policy_name: resolved.name, renamed: resolved.renamed, already_uploaded: false };
  },
});
