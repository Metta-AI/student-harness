import type { SessionAuth } from "eve/context";
import { z } from "zod";
const schema = z.object({ studentId: z.string().min(1), wakeId: z.uuid(), token: z.uuid() });
export function researchIdentity(auth: SessionAuth) {
  const p = auth.initiator;
  return p?.authenticator === "research-orchestrator" ? schema.parse(p.attributes) : null;
}
