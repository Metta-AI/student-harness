import { NextResponse } from "next/server";
import { deleteWorkspaceFiles, latestPolicyVersion, listExperiments, listPolicyVersions, policyVersionByRevision, toRevision, workspaceFile } from "../../../lib/db";
import { currentSession, sameOrigin } from "../../../lib/session";

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
  const [versions, experiments, latest, draft, draftParent] = await Promise.all([
    listPolicyVersions(session.subjectId), listExperiments(session.subjectId), latestPolicyVersion(session.subjectId), workspaceFile(session.subjectId, "draft/hero.bas"), workspaceFile(session.subjectId, "draft/parent.txt"),
  ]);
  const uploaded = [...versions].reverse().find((version) => version.softmax_policy_version_id);
  return NextResponse.json({
    versions: versions.map((version) => {
      const games = experiments.filter((experiment) => experiment.policy_version_id === version.id);
      const scores = games.flatMap((game) => game.episodes.flatMap((episode) => episode.our_scores));
      const completed = games.filter((game) => game.status === "completed");
      const deaths = completed.map((game) => (game.summary as { mean_deaths_per_seat?: number | null } | null)?.mean_deaths_per_seat).filter((value): value is number => typeof value === "number");
      return {
        id: version.id, revision: version.revision_number, summary: version.summary, created_at: version.created_at,
        policyVersionId: version.softmax_policy_version_id, label: version.softmax_policy_label,
        games: games.length, hostedMean: scores.length ? scores.reduce((total, score) => total + score, 0) / scores.length : null, scored: scores.length,
        completedGames: completed.length, meanDeaths: deaths.length ? deaths.reduce((total, value) => total + value, 0) / deaths.length : null, deathSamples: deaths.length,
      };
    }),
    experiments: experiments.map((experiment) => ({
      xpRequestId: experiment.xp_request_id, title: experiment.title, status: experiment.status, created_at: experiment.created_at, completed_at: experiment.completed_at,
      completedGames: experiment.episodes.filter((episode) => episode.status === "completed").length,
      replayReady: experiment.episodes.some((episode) => episode.status === "completed" && !!episode.replay_url),
      score: (experiment.summary as { mean_policy_score?: number | null } | null)?.mean_policy_score ?? null,
      revision: versions.find((version) => version.id === experiment.policy_version_id)?.revision_number ?? null,
    })),
    latest: latest ? toRevision(latest) : null,
    latestUpload: uploaded ? { policyVersionId: uploaded.softmax_policy_version_id!, label: uploaded.softmax_policy_label ?? uploaded.softmax_policy_version_id! } : null,
    draft: draft ? { updated_at: draft.updated_at, bytes: Buffer.byteLength(draft.content, "utf8"), conflict: latest ? draftParent?.content !== latest.revision_id : false } : null,
  });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  await deleteWorkspaceFiles(session.subjectId, ["draft/hero.bas", "draft/parent.txt"]);
  return NextResponse.json({ discarded: true });
}
