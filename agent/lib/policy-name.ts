import { setStudentPolicyName, studentPolicyName } from "../../lib/db";
import { policyNameFor } from "../../lib/softmax";

/**
 * The Softmax policy name to upload under. A proposed character name becomes the student's
 * policy name (a rename starts a new version lineage on Softmax); otherwise the stored name is
 * reused; with neither, the caller must ask the agent for one.
 */
export async function resolvePolicyName(subjectId: string, proposed?: string): Promise<{ name: string; renamed: boolean } | null> {
  const stored = await studentPolicyName(subjectId);
  if (proposed) {
    const name = policyNameFor(subjectId, proposed);
    if (name !== stored) await setStudentPolicyName(subjectId, name);
    return { name, renamed: stored !== null && stored !== name };
  }
  return stored ? { name: stored, renamed: false } : null;
}
