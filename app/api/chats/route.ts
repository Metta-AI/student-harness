import { NextResponse } from "next/server";
import { z } from "zod";
import { archiveChatSession, listChatSessions, upsertChatSession } from "../../../lib/db";
import { currentSession, sameOrigin } from "../../../lib/session";

const opponent = z.object({ policyId: z.uuid(), leagueId: z.string().regex(/^league_[a-zA-Z0-9-]+$/) }).strict();

const sessionId = z.string().min(4).max(128);

const hostOf = (request: Request) => request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  return NextResponse.json({ chats: await listChatSessions(session.subjectId, hostOf(request)) });
}

/** Record a durable coach session so the student can reopen it later. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const body = z.object({ sessionId, title: z.string().max(80).optional(), opponent: opponent.optional() }).parse(await request.json());
  return NextResponse.json({ chat: await upsertChatSession({ studentId: session.subjectId, sessionId: body.sessionId, title: body.title, opponent: body.opponent, host: hostOf(request) }) });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const body = z.object({ sessionId }).parse(await request.json());
  await archiveChatSession(session.subjectId, body.sessionId);
  return NextResponse.json({ ok: true });
}
