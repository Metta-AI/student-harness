import { preferencesPatchSchema } from "../../../lib/preferences";
import { saveUserPreferences, userPreferences } from "../../../lib/preferences-store";
import { currentSession, sameOrigin } from "../../../lib/session";
import { trackServer } from "../../../lib/analytics-server";
import { events } from "../../../lib/analytics-events";

const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401, headers });
  try { return Response.json(await userPreferences(session.subjectId), { headers }); }
  catch { return Response.json({ error: "Couldn’t load your settings. Try again." }, { status: 503, headers }); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403, headers });
  const session = await currentSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401, headers });
  const parsed = preferencesPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Check your settings and try again." }, { status: 400, headers });
  try {
    const saved = await saveUserPreferences(session.subjectId, parsed.data);
    if (parsed.data.reasoningEffort) {
      await trackServer(session.subjectId, events.reasoningEffortChanged, { effort: saved.reasoningEffort }, { reasoning_effort: saved.reasoningEffort }).catch(() => {});
    }
    return Response.json(saved, { headers });
  } catch { return Response.json({ error: "Couldn’t save your settings. Your changes are still here to retry." }, { status: 503, headers }); }
}
