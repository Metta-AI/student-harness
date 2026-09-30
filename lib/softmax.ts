import { createHash } from "node:crypto";
import { z } from "zod";
import league from "../league.json";

const api = process.env.SOFTMAX_API_URL ?? "https://softmax.com/api";

const whoamiSchema = z.object({
  subject_id: z.string(),
  subject_type: z.string(),
  user_email: z.email(),
});

const uploadSchema = z.object({
  upload_url: z.url().nullable().optional(),
  existing_policy_version: z.object({ id: z.string() }).nullable().optional(),
});

const policyVersionSchema = z.object({ id: z.string(), name: z.string(), version: z.number() });
const xpSchema = z.object({ id: z.string(), status: z.string() });
const submissionSchema = z.object({ id: z.string(), status: z.string() });
const submissionPageSchema = z.union([z.array(submissionSchema), z.object({ entries: z.array(submissionSchema) })]);
const leagueSchema = z.object({
  id: z.string(), name: z.string(), description: z.string().nullable(),
  rounds_paused_at: z.string().nullable(), submissions_locked_at: z.string().nullable(),
  settings: z.object({ ladder: z.object({ enabled: z.boolean() }) }),
});
const experienceSchema = z.object({
  id: z.string(), requester_user_id: z.string(), status: z.string(),
  episode_count: z.number(), pending_count: z.number(), submitted_count: z.number(),
  running_count: z.number(), completed_count: z.number(), failed_count: z.number(),
  created_at: z.string(), completed_at: z.string().nullable(),
  title: z.string().nullable().optional(),
});
const episodeSchema = z.object({
  id: z.string(), status: z.string(), replay_url: z.string().nullable(),
  live_url: z.string().nullable(), episode_id: z.string().nullable(),
  error: z.string().nullable(), job_index: z.number().nullable(),
  participant_scores: z.array(z.object({ position: z.number(), score: z.number() })),
  created_at: z.string(), completed_at: z.string().nullable(),
});
const experiencePageSchema = z.object({ entries: z.array(experienceSchema) });
const experienceDetailSchema = experienceSchema.extend({ episodes: z.array(episodeSchema) });
const coachingAnalysisSummarySchema = z.object({ id: z.string(), status: z.string() });
const coachingSessionSchema = z.object({
  id: z.string(), episode_id: z.string(), user_id: z.string(), coworld_name: z.string().nullable(),
  status: z.string(), created_at: z.string(), duration_ms: z.number().nullable(),
  latest_analysis: coachingAnalysisSummarySchema.nullable(),
  feed: z.object({
    summary: z.string().nullable(), quote: z.string().nullable(), insights: z.array(z.string()),
  }).nullable(),
  policy_reference: z.object({ policy_version_id: z.string().nullable(), slot: z.number().nullable() }),
});
const coachingSessionDetailSchema = coachingSessionSchema.extend({ declared_context: z.string() });
const coachingAnalysisSchema = z.object({
  status: z.string(),
  result: z.object({
    summary: z.string(),
    moments: z.array(z.object({
      start_ms: z.number(), end_ms: z.number(), observation: z.string(),
      coaching_intent: z.string(), uncertainty: z.string(), evidence_ids: z.array(z.string()),
    })),
    ir_proposals: z.array(z.object({
      layer: z.string(), change: z.string(), rationale: z.string(),
      verification: z.string(), evidence_ids: z.array(z.string()),
    })),
    questions: z.array(z.string()),
  }).nullable(),
});
const episodeStatsSchema = z.object({
  steps: z.number().nullable(), game_stats: z.record(z.string(), z.number()),
  policy_stats: z.array(z.object({
    position: z.number(), policy_name: z.string().nullable(), avg_reward: z.number(),
    avg_metrics: z.record(z.string(), z.number()),
  })),
});

export class SoftmaxError extends Error {
  constructor(public status: number, path: string, detail: string) {
    super(`Softmax ${path} returned ${status}: ${detail}`);
  }
}

async function softmax<T extends z.ZodType>(path: string, token: string, schema: T, body?: unknown): Promise<z.infer<T>> {
  const response = await fetch(`${api}/observatory${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) throw new SoftmaxError(response.status, path, (await response.text()).slice(0, 500));
  return schema.parse(await response.json()) as z.infer<T>;
}

export async function whoami(token: string) {
  return softmax("/whoami", token, whoamiSchema);
}

export async function getLeague(token: string) {
  return softmax(`/v2/leagues/${league.id}`, token, leagueSchema);
}

export async function listExperiences(token: string) {
  const params = new URLSearchParams({ mine: "true", league_id: league.id, limit: "8" });
  return (await softmax(`/v2/experience-requests?${params}`, token, experiencePageSchema)).entries;
}

export async function getExperience(token: string, requestId: string) {
  return softmax(`/v2/experience-requests/${requestId}`, token, experienceDetailSchema);
}

export async function listCoachingSessions(token: string) {
  const sessions = await softmax("/v2/coaching-sessions?limit=30", token, z.array(coachingSessionSchema));
  return sessions.filter((session) => session.coworld_name === league.name);
}

export async function getCoachingSession(token: string, sessionId: string) {
  return softmax(`/v2/coaching-sessions/${sessionId}`, token, coachingSessionDetailSchema);
}

export async function getCoachingAnalysis(token: string, sessionId: string, analysisId: string) {
  return softmax(`/v2/coaching-sessions/${sessionId}/analyses/${analysisId}`, token, coachingAnalysisSchema);
}

export async function getEpisodeStats(token: string, episodeId: string) {
  return softmax(`/v2/episode-requests/${episodeId}/episode-stats`, token, episodeStatsSchema);
}

export async function uploadPolicy(token: string, subjectId: string, source: string, title: string) {
  const bytes = Buffer.from(source, "utf8");
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const name = `neuralhub-${createHash("sha256").update(subjectId).digest("hex").slice(0, 16)}`;
  const body = {
    name,
    content_hash: contentHash,
    size_bytes: bytes.length,
    tags: { title: title.slice(0, 50), description: "Student policy edited in NeuralHub harness" },
  };
  const upload = await softmax("/stats/policies/files/upload", token, uploadSchema, body);
  if (upload.upload_url) {
    const put = await fetch(upload.upload_url, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    });
    if (!put.ok) throw new Error(`Policy file upload returned ${put.status}`);
  }
  return softmax("/stats/policies/files/complete", token, policyVersionSchema, body);
}

export async function requestEpisode(token: string, policyVersionId: string, title: string) {
  return softmax("/v2/experience-requests", token, xpSchema, {
    idempotency_key: `neuralhub-${policyVersionId}`,
    target: { league_id: league.id },
    roster: Array.from({ length: 10 }, () => ({ player: { policy_ref: policyVersionId }, slot: -1 })),
    num_episodes: 1,
    title: title.slice(0, 50),
    description: "One hosted self-play episode for the student's policy",
  });
}

export async function submitPolicy(token: string, policyVersionId: string) {
  const params = new URLSearchParams({
    mine: "true",
    league_id: league.id,
    policy_version_id: policyVersionId,
    limit: "1",
  });
  const existing = await softmax(`/v2/league-submissions?${params}`, token, submissionPageSchema);
  const entries = Array.isArray(existing) ? existing : existing.entries;
  if (entries.length) return entries[0];
  return softmax("/v2/league-submissions", token, submissionSchema, {
    league_id: league.id,
    policy_version_id: policyVersionId,
    auto_champion: "always",
  });
}
