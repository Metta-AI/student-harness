import { NextResponse } from "next/server";
import { latestPolicyVersion, listExperiments, listPolicyVersions, policyVersionByRevision, toRevision } from "../../../lib/db";
import { currentSession } from "../../../lib/session";

/** The student's durable workspace: saved revisions, hosted games, and the latest revision pair. */
export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const revisionParam = new URL(request.url).searchParams.get("revision");
  if (revisionParam) {
    const version = await policyVersionByRevision(session.subjectId, Number(revisionParam));
    if (!version) return NextResponse.json({ error: "Revision not found" }, { status: 404 });
    return NextResponse.json({ revision: toRevision(version), upload: version.softmax_policy_version_id ? { policyVersionId: version.softmax_policy_version_id, label: version.softmax_policy_label } : null });
  }
  const [versions, experiments, latest] = await Promise.all([
    listPolicyVersions(session.subjectId), listExperiments(session.subjectId), latestPolicyVersion(session.subjectId),
  ]);
  const uploaded = [...versions].reverse().find((version) => version.softmax_policy_version_id);
  return NextResponse.json({
    versions: versions.map((version) => {
      const games = experiments.filter((experiment) => experiment.policy_version_id === version.id);
      const scores = games.flatMap((game) => game.episodes.flatMap((episode) => episode.our_scores));
      return {
        id: version.id, revision: version.revision_number, summary: version.summary, created_at: version.created_at,
        policyVersionId: version.softmax_policy_version_id, label: version.softmax_policy_label,
        games: games.length, hostedMean: scores.length ? scores.reduce((total, score) => total + score, 0) / scores.length : null, scored: scores.length,
      };
    }),
    experiments: experiments.map((experiment) => ({
      xpRequestId: experiment.xp_request_id, title: experiment.title, status: experiment.status, created_at: experiment.created_at,
      revision: versions.find((version) => version.id === experiment.policy_version_id)?.revision_number ?? null,
    })),
    latest: latest ? toRevision(latest) : null,
    latestUpload: uploaded ? { policyVersionId: uploaded.softmax_policy_version_id!, label: uploaded.softmax_policy_label ?? uploaded.softmax_policy_version_id! } : null,
  });
}
