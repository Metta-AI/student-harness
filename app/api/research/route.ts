import { z } from "zod";
import { rpc } from "../../../lib/tasks/store";
import { evaluationSchema } from "../../../lib/research/model";
import { NextResponse } from "next/server";
import { currentSession, sameOrigin } from "../../../lib/session";
import { appendNote, createCycle, readResearch, recordMoment, grantAllowance, proposeExperiment } from "../../../lib/research/store";

export async function GET() {
  const student = await currentSession();
  if (!student) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  try { return NextResponse.json(await readResearch(student.subjectId), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Research is unavailable. Retry shortly." }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const student = await currentSession();
  if (!student) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  try {
    const { action, ...input } = await request.json();
    if (action === "create") return NextResponse.json({ cycle: await createCycle(student.subjectId, input) }, { status: 201 });
    if (action === "note") return NextResponse.json({ id: await appendNote(student.subjectId, input, "human") }, { status: 201 });
    if (action === "moment") return NextResponse.json({ id: await recordMoment(student.subjectId, input) }, { status: 201 });
    if (action === "grant") return NextResponse.json({ result: await grantAllowance(student.subjectId, input) });
    if (action === "propose") return NextResponse.json({ id: await proposeExperiment(student.subjectId, input, "human") }, { status: 201 });
    if (action === "evaluate") {
      const p = evaluationSchema.parse(input);
      return NextResponse.json({ id: await rpc("research_evaluate", { p_student: student.subjectId, p_cycle: p.cycleId, p_candidate: p.candidateId,
        p_baseline_xp: p.baselineXp, p_candidate_xp: p.candidateXp, p_finding: p.finding, p_explanation: p.explanation, p_key: p.requestKey }) });
    }
    const p = z.object({ cycleId: z.uuid(), requestKey: z.string().min(8).max(160), planId: z.uuid().optional(), versionId: z.uuid().optional(), evaluationId: z.uuid().optional(),
      fromCycleId: z.uuid().optional(), reason: z.string().trim().min(5).max(2000).optional() }).parse(input);
    const args = { p_student: student.subjectId, p_cycle: p.cycleId, p_key: p.requestKey };
    if (["pause", "resume", "close"].includes(action)) return NextResponse.json({ result: await rpc("research_control", { ...args, p_action: action }) });
    if (action === "decline" && p.planId) return NextResponse.json({ result: await rpc("research_cancel_plan", { p_student: student.subjectId, p_plan: p.planId, p_key: p.requestKey }) });
    if (action === "start" && p.planId) return NextResponse.json({ taskId: await rpc("research_start_plan", { p_student: student.subjectId, p_plan: p.planId, p_manual: true }) });
    if (action === "select" && p.versionId && p.reason) return NextResponse.json({ result: await rpc("research_select_policy", { ...args, p_version: p.versionId, p_evaluation: p.evaluationId ?? null, p_reason: p.reason }) });
    if (action === "carryover" && p.fromCycleId) return NextResponse.json({ result: await rpc("research_carryover", { p_student: student.subjectId, p_from: p.fromCycleId, p_to: p.cycleId, p_key: p.requestKey }) });
    throw new Error("Unknown or incomplete research action");
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Research update failed" }, { status: 400 }); }
}
