import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { upsertWorkspaceFiles } from "../../../lib/db";
import { currentSession, sameOrigin } from "../../../lib/session";
import { trackServer } from "../../../lib/analytics-server";
import { events } from "../../../lib/analytics-events";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const input = z.object({ name: z.string().min(1).max(100), content: z.string().min(1) }).parse(await request.json());
  const isPolicy = input.name.toLowerCase().endsWith(".bas");
  const bytes = Buffer.byteLength(input.content, "utf8");
  const limit = isPolicy ? 64 * 1024 : 256 * 1024;
  if (bytes > limit) {
    await trackServer(session.subjectId, events.attachmentRejected, { type: isPolicy ? "policy" : "text", bytes, limit, reason: "too_large" });
    return NextResponse.json({ error: `${isPolicy ? "BASIC policies" : "Text attachments"} must be under ${limit / 1024} KiB. This file is ${Math.ceil(bytes / 1024)} KiB.` }, { status: 413 });
  }
  const id = randomUUID();
  const path = `attachments/${id}.${isPolicy ? "bas" : "txt"}`;
  await upsertWorkspaceFiles(session.subjectId, [{ path, content: input.content, sha256: createHash("sha256").update(input.content).digest("hex") }]);
  await trackServer(session.subjectId, events.attachmentUploaded, { type: isPolicy ? "policy" : "text", bytes });
  return NextResponse.json({ id, name: input.name, path, bytes, type: isPolicy ? "policy" : "text" });
}
