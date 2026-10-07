import { createTask, listTasks, taskById } from "../../../../lib/tasks/store";
import { opponentResearch } from "../../../../lib/opponents/store";
import { defaultLeagueId } from "../../../../lib/league-catalog";
import { z } from "zod";
import { currentSession, sameOrigin } from "../../../../lib/session";
import { verifyVoiceLease } from "../../../../lib/voice/server";
import { voiceToolInputs } from "../../../../lib/voice/config";
import { readVoiceWorkspace } from "../../../../lib/voice/workspace";
import { readAutonomy, wakeResearch } from "../../../../lib/research/autonomy";
import { readResearch } from "../../../../lib/research/store";
import { db } from "../../../../lib/db";

import { runSoftmaxCli } from "../../../../lib/voice/cli";
import { readLiveLeague } from "../../../../lib/voice/league";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const student = await currentSession(); if (!student) return Response.json({ error: "Sign in first" }, { status: 401 });
  let p: { lease: string; callId: string; name: string; args: unknown }, live: { session: string;leagueId?:string };
  try {
    p = z.object({ lease: z.string().max(2000), callId: z.string().min(1).max(100), name: z.enum(["opponent_research", "softmax_cli", "live_league", "read_workspace", "research_status", "start_research", "pause_research", "start_session", "session_status"]), args: z.unknown() }).parse(await request.json());
    live = verifyVoiceLease(p.lease, student.subjectId);
    voiceToolInputs[p.name as keyof typeof voiceToolInputs].parse(p.args);
  } catch { return Response.json({ error: "Invalid or expired voice tool request" }, { status: 400 }); }
  const selectedLeague=live.leagueId??defaultLeagueId;
  if(selectedLeague!==defaultLeagueId && ["read_workspace","research_status","start_research","pause_research","opponent_research","start_session","session_status"].includes(p.name))return Response.json({result:{ok:false,error:"Policy development is available in the default GoTA workspace. This league supports live standings, rounds, reference lookups and generated views."}},{status:400});
  const started = performance.now();
  try {
    let result: unknown;
    switch (p.name) {
      case "opponent_research": {result=await opponentResearch(student.subjectId,student.token,p.args,"preston",selectedLeague);break;}
      case "softmax_cli": {result=await runSoftmaxCli(student.token,p.args);break;}
      case "live_league": {if(selectedLeague!==defaultLeagueId){result=await (await import("../../../../lib/league-overview")).readLeagueOverview(student.token,selectedLeague);break;}result=await readLiveLeague(student.subjectId,student.token,voiceToolInputs.live_league.parse(p.args).includeRecord);break;}
      case "read_workspace": {
        result = await readVoiceWorkspace(student.subjectId, voiceToolInputs.read_workspace.parse(p.args).includeSource); break;
      }
      case "research_status": {
        const [autonomy, research] = await Promise.all([readAutonomy(student.subjectId), readResearch(student.subjectId)]);
        result = { ...autonomy, available: autonomy.available && research.available, cycles: research.cycles, workers: research.usage, recent: research.events.slice(-20) }; break;
      }
      case "start_session": {
        const args = voiceToolInputs.start_session.parse(p.args);
        if(args.autoresearch){
          const {createCampaign}=await import('../../../../lib/campaigns/store');
          const campaign=await createCampaign(student.subjectId,{objective:args.objective,leagueId:selectedLeague,requestKey:`voice:${live.session}:${p.callId}`},live.session);
          result={ok:true,campaignId:campaign.id,taskId:campaign.task_id,status:campaign.state,url:`/sessions/${campaign.task_id}`,note:'Persistent autoresearch queued. Preston will analyze, test and verify deployments under standing authority.'};
          break;
        }
        const task = await createTask(student.subjectId, {
          kind: "research", objective: args.objective, acceptanceCriteria: args.acceptanceCriteria,
          context: {mode:"auto",leagueId:selectedLeague,title:args.title,policyId:args.policyId,episodeId:args.episodeId},
          maxCostUsd: args.budgetUsd, maxModelCalls: 100,
          requestKey: `voice:${live.session}:${p.callId}`,
        }, live.session);
        result = {ok:true,taskId:task.id,status:task.status,url:`/sessions/${task.id}`,objective:task.objective,budgetUsd:task.max_cost_usd,note:"Background session saved. Execution continues independently of voice. No result is confirmed yet."};
        break;
      }
      case "session_status": {
        const {taskId}=voiceToolInputs.session_status.parse(p.args);
        const listing=taskId ? null : await listTasks(student.subjectId);
        const tasks=taskId ? [await taskById(taskId,student.subjectId)].filter(t=>t!==null) : listing!.tasks;
        result={ok:true,budget:listing?.budget,sessions:tasks.map(t=>({taskId:t.id,status:t.status,objective:t.objective,progress:t.checkpoint.research_progress??null,result:t.result,reason:t.reason,url:`/sessions/${t.id}`}))};
        break;
      }
      case "start_research": {
        const args = voiceToolInputs.start_research.parse(p.args);
        result = await wakeResearch(student.subjectId, args.direction, `voice:${live.session}:${p.callId}`); break;
      }
      case "pause_research": {
        const { data, error } = await db().from("research_settings").update({ enabled: false }).eq("student_id", student.subjectId).select("student_id");
        if (error) throw error;
        result = { paused: !!data.length, note: data.length ? "Further research operations paused. Already submitted games may finish." : "No autonomous research is configured." }; break;
      }
    }
    const durationMs = Math.round(performance.now() - started);
    const log = durationMs > 2000 ? console.warn : console.info;
    log("Preston voice tool", { tool: p.name, durationMs, slow: durationMs > 2000, status: "returned" });
    return Response.json({ result, timing: { durationMs } }, { headers: { "Cache-Control": "no-store", "Server-Timing": `tool;dur=${durationMs}` } });
  } catch {
    console.warn("Preston voice tool", { tool: p.name, durationMs: Math.round(performance.now() - started), status: "failed" });
    return Response.json({ result: { ok: false, error: "Workspace operation unavailable. No successful action is confirmed; do not claim it ran." } }, { status: 503 });
  }
}
