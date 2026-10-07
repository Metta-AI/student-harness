import { defaultLeagueId,leagueIdSchema } from "../league-catalog";
import { z } from "zod";
import { sealJson, unsealJson } from "../crypto";

const leaseSchema = z.object({ kind: z.literal("preston-live"), student: z.string(), session: z.string(), leagueId:leagueIdSchema.default(defaultLeagueId), expires: z.number() });
export function createVoiceLease(student: string, session: string, leagueId=defaultLeagueId) {
  return sealJson({ kind: "preston-live", student, session, leagueId, expires: Date.now() + 60 * 60_000 });
}
export function verifyVoiceLease(lease: string, student: string) {
  const parsed = leaseSchema.parse(unsealJson(lease));
  if (parsed.student !== student || parsed.expires <= Date.now()) throw new Error("Voice session expired");
  return parsed;
}
// A local burst guard; account/provider quotas remain the deployment-wide spending boundary.
const starts = new Map<string, number>();
export function reserveVoiceStart(student: string) {
  const now = Date.now();
  for (const [id, time] of starts) if (now - time > 10_000) starts.delete(id);
  if (starts.has(student)) return false;
  starts.set(student, now); return true;
}
export function openAIBaseURL() {
  return (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
}

// Offline transcript delivery is read/write logging only, never authority to execute tools.
export function verifyVoiceTranscriptLease(lease: string, student: string) {
  const parsed=leaseSchema.parse(unsealJson(lease));
  if(parsed.student!==student||parsed.expires+7*86400_000<=Date.now())throw new Error('Transcript session expired');
  return parsed;
}
