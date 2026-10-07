import {db} from "../../../lib/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession, sameOrigin } from "../../../lib/session";
import { taskInputSchema } from "../../../lib/tasks/model";
import { createTask, listTasks, controlTask } from "../../../lib/tasks/store";

export async function GET(request?:Request) {
  const student = await currentSession();
  if (!student) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const url=request?new URL(request.url):null,campaign=url?.searchParams.get('campaign');
  if(campaign){
    if(!z.uuid().safeParse(campaign).success)return NextResponse.json({error:'Invalid campaign'},{status:400});
    let query=db().from('agent_tasks').select('*').eq('student_id',student.subjectId).eq('context->>campaignId',campaign).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(100);
    const rows=await query;
    if(rows.error)return NextResponse.json({error:'Sessions unavailable'},{status:503});
    return NextResponse.json({tasks:rows.data},{headers:{'Cache-Control':'no-store'}});
  }
  try { return NextResponse.json(await listTasks(student.subjectId), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { console.error("List tasks failed", error); return NextResponse.json({ error: "Tasks are unavailable. Please retry." }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const student = await currentSession();
  if (!student) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  try {
    const input = taskInputSchema.parse(await request.json());
    return NextResponse.json({ task: await createTask(student.subjectId, input) }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create task" }, { status: 400 }); }
}
export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const student = await currentSession();
  if (!student) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  try {
    const input = z.object({ taskId: z.uuid(), action: z.enum(["pause", "resume", "cancel", "steer"]), note: z.string().trim().max(2000).default("") }).parse(await request.json());
    return NextResponse.json({ task: await controlTask(student.subjectId, input.taskId, input.action, input.note) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update task" }, { status: 400 }); }
}
