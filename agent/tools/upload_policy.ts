import { defineTool } from "eve/tools";
import { z } from "zod";
import { latestPolicyVersion, markPolicyUploaded, policyVersionByRevision } from "../../lib/db";
import { uploadPolicy } from "../../lib/softmax";
import { requireStudentToken } from "../lib/student";

export default defineTool({
  description: "Upload a saved revision to Softmax as a policy version under the student's account. Idempotent: re-uploading identical source returns the existing version. Defaults to the latest saved revision.",
  inputSchema: z.object({ revision: z.number().int().positive().optional().describe("Saved revision number. Omit for the latest.") }),
  label: { start: ({ revision }) => `Upload revision ${revision ?? "latest"} to Softmax` },
  async execute({ revision }, ctx) {
    const student = await requireStudentToken(ctx);
    const version = revision === undefined ? await latestPolicyVersion(student.subjectId) : await policyVersionByRevision(student.subjectId, revision);
    if (!version) throw new Error(revision === undefined ? "No saved revision yet. Edit hero.bas and call save_policy_version first." : `Revision ${revision} does not exist.`);
    if (version.softmax_policy_version_id) {
      return { revision: version.revision_number, policy_version_id: version.softmax_policy_version_id, policy_label: version.softmax_policy_label, already_uploaded: true };
    }
    const policy = await uploadPolicy(student.token, student.subjectId, version.source, version.summary);
    const label = `${policy.name}:v${policy.version}`;
    await markPolicyUploaded(version.id, { policyVersionId: policy.id, label });
    return { revision: version.revision_number, policy_version_id: policy.id, policy_label: label, already_uploaded: false };
  },
});
