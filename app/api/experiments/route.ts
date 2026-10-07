import { NextResponse } from "next/server";
import { currentSession } from "../../../lib/session";
import { experimentByXp, listPolicyVersions, policyVersionByRevision } from "../../../lib/db";
import { experimentDetail } from "../../../lib/workspace/experiment-detail";

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^xreq_[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Invalid experiment" }, { status: 400 });
  try {
    const experiment = await experimentByXp(session.subjectId, id);
    if (!experiment) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
    const versions = experiment.policy_version_id ? await listPolicyVersions(session.subjectId) : [];
    const linked = versions.find(v => v.id === experiment.policy_version_id);
    const version = linked ? await policyVersionByRevision(session.subjectId, linked.revision_number) : null;
    return NextResponse.json(experimentDetail(experiment, version), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Experiment details could not be loaded." }, { status: 503 });
  }
}
