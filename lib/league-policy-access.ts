import { policyVersionBySoftmaxId } from "./db";
import { listLeagueSubmissions } from "./softmax";
/** Policies submitted outside this IDE still belong to the signed-in user's league workspace. */
export async function leaguePolicyAccess(studentId: string, token: string, policyId: string) {
  const local = await policyVersionBySoftmaxId(studentId, policyId);
  if (local) return { revision: local.revision_number };
  const mine = await listLeagueSubmissions(token);
  return mine.some(s => s.policy_version?.id === policyId) ? { revision: null } : null;
}
