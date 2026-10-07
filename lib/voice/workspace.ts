import { db } from "../db";

/** Keep source/IR, receipts and unbounded histories out of routine spoken lookups. */
export async function readVoiceWorkspace(studentId: string, includeSource = false) {
  const signal = AbortSignal.timeout(12_000);
  const policyColumns = `id, revision_number, summary, softmax_policy_version_id${includeSource ? ', source' : ''}`;
  const [policy, versions, games] = await Promise.all([
    db().from('policy_versions').select(policyColumns).eq('student_id', studentId).order('revision_number', { ascending: false }).limit(1).abortSignal(signal).maybeSingle(),
    db().from('policy_versions').select('id, revision_number, summary').eq('student_id', studentId).order('revision_number', { ascending: false }).limit(20).abortSignal(signal),
    db().from('experiments').select('xp_request_id, policy_version_id, status, summary').eq('student_id', studentId).order('created_at', { ascending: false }).limit(20).abortSignal(signal),
  ]);
  if (policy.error || versions.error || games.error) throw new Error('Workspace lookup unavailable');
  return {
    policy: policy.data,
    sourceIncluded: includeSource,
    versions: (versions.data ?? []).reverse().map(v => ({ id: v.id, revision: v.revision_number, summary: v.summary })),
    experiments: (games.data ?? []).map(g => ({ id: g.xp_request_id, versionId: g.policy_version_id, status: g.status, summary: g.summary })),
    window: { versions: 20, experiments: 20 },
  };
}
