import { NextResponse } from "next/server";
import { currentSession, sameOrigin } from "../../../lib/session";
import { createClaim, readPartner, respondToClaim } from "../../../lib/partner/store";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  try { return NextResponse.json(await readPartner(session.subjectId), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Shared work could not be loaded. Please retry." }, { status: 503 }); }
}
async function write(request: Request, response: boolean) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  try {
    const input = await request.json();
    const claim = response ? await respondToClaim(session.subjectId, input, "human") : await createClaim(session.subjectId, input, "human");
    return NextResponse.json({ claim }, { status: response ? 200 : 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save" }, { status: 400 }); }
}
export function POST(request: Request) { return write(request, false); }
export function PATCH(request: Request) { return write(request, true); }
