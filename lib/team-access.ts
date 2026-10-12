import { createHash } from "node:crypto";
import { SoftmaxError, whoami } from "./softmax";
import type { Session } from "./student-session";

export class TeamAccessError extends Error {
  readonly status: 401 | 403 | 503;
  constructor(status: 401 | 403 | 503, message: string) {
    super(message);
    this.status = status;
  }
}

type Identity = Awaited<ReturnType<typeof whoami>>;
const ttl = 30_000;
const maxEntries = 256;
// Store only token fingerprints, never credentials. Share simultaneous workspace reads.
const checks = new Map<string, { expires: number; result: Promise<Identity> }>();

/** A user token is necessary but insufficient: Softmax must explicitly confirm team membership. */
export async function teamIdentity(token: string): Promise<Identity> {
  const key = createHash("sha256").update(token).digest("hex");
  const cached = checks.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  checks.delete(key);
  if (checks.size >= maxEntries) checks.delete(checks.keys().next().value!);
  // Softmax masks membership unless this identity request opts in to existing privileges.
  const result = whoami(token, AbortSignal.timeout(5000), true).catch((error: unknown) => {
    if (error instanceof SoftmaxError && (error.status === 401 || error.status === 403)) {
      throw new TeamAccessError(401, "That Softmax token is invalid or expired.");
    }
    throw new TeamAccessError(503, "Could not verify Softmax team membership. Please retry.");
  }).then(identity => {
    if (identity.subject_type !== "user" || identity.is_softmax_team_member !== true) {
      throw new TeamAccessError(403, "This IDE is currently restricted to Softmax team members. Use your Softmax team user token.");
    }
    return identity;
  });
  const entry = { expires: Date.now() + ttl, result };
  checks.set(key, entry);
  // Never reuse a failed verification, including outages and missing team claims.
  void result.catch(() => { if (checks.get(key) === entry) checks.delete(key); });
  return result;
}

/** Revalidate old cookies as well as new ones; a sealed cookie is not a team membership grant. */
export async function teamSession(session: Session | null): Promise<Session | null> {
  if (!session) return null;
  try {
    const identity = await teamIdentity(session.token);
    if (identity.subject_id !== session.subjectId) return null;
    return { ...session, email: identity.user_email, name: identity.name ?? null };
  } catch {
    return null;
  }
}
