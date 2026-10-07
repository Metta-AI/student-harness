import type { SessionAuth } from "eve/context";
import { z } from "zod";
const identity = z.object({ taskId: z.uuid(), generation: z.coerce.number().int().nonnegative(), studentId: z.string().min(1) });
export function taskIdentity(auth: SessionAuth) {
  const principal = auth.initiator;
  if (principal?.authenticator !== "task-runner") return null;
  return identity.parse(principal.attributes);
}
