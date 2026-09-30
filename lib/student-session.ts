import { z } from "zod";
import { sealJson, unsealJson } from "./crypto";

/** Framework-free student session codec, shared by the Next routes and the eve channel. */
export const cookieName = "student_session";

const sessionSchema = z.object({
  token: z.string().min(1),
  subjectId: z.string().min(1),
  email: z.email(),
});

export type Session = z.infer<typeof sessionSchema>;

export function seal(session: Session) {
  return sealJson(session);
}

export function unseal(value: string): Session {
  return sessionSchema.parse(unsealJson(value));
}

export function sessionFromCookieHeader(header: string | null): Session | null {
  if (!header) return null;
  const match = header.split(/;\s*/).map((part) => part.split("=")).find(([name]) => name === cookieName);
  if (!match?.[1]) return null;
  try {
    return unseal(decodeURIComponent(match.slice(1).join("=")));
  } catch {
    return null;
  }
}
