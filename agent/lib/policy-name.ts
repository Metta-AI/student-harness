import { setStudentPolicyName, studentPolicyName } from "../../lib/db";
import { policyNameFor, policyStyleFromSummary } from "../../lib/softmax";

/**
 * The Softmax policy name to upload under. A proposed character name becomes the student's
 * policy name (a rename starts a new version lineage on Softmax); otherwise the stored name is
 * reused. When the agent omitted a name on the first upload, derive a safe gameplay name
 * so the student can still submit in the same turn.
 */
export async function resolvePolicyName(subjectId: string, proposed?: string, summary?: string): Promise<{ name: string; renamed: boolean }> {
  const stored = await studentPolicyName(subjectId);
  if (proposed || !stored) {
    const name = policyNameFor(subjectId, proposed ?? policyStyleFromSummary(summary ?? ""));
    if (name !== stored) await setStudentPolicyName(subjectId, name);
    return { name, renamed: stored !== null && stored !== name };
  }
  return { name: stored, renamed: false };
}
