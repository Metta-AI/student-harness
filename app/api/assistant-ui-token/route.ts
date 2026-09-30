import { AssistantCloud } from "assistant-cloud";
import { currentSession, sameOrigin } from "../../../lib/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Invalid origin", { status: 403 });
  const session = await currentSession();
  if (!session) return new Response("Sign in first", { status: 401 });

  const cloud = new AssistantCloud({
    apiKey: process.env.ASSISTANT_API_KEY!,
    userId: session.subjectId,
    workspaceId: session.subjectId,
  });
  const { token } = await cloud.auth.tokens.create();
  return new Response(token, { headers: { "Cache-Control": "no-store" } });
}
