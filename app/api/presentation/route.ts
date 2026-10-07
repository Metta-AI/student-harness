import { currentSession, sameOrigin } from "../../../lib/session";
import { preparePresentation } from "../../../lib/workspace/presentation-server";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const student = await currentSession(); if (!student) return Response.json({ error: "Sign in first" }, { status: 401 });
  try { return Response.json(await preparePresentation(student.subjectId, await request.json()), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "This view or its evidence is unavailable." }, { status: 400 }); }
}
