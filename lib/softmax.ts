import { createHash } from "node:crypto";
import { z } from "zod";
import league from "../league.json" with { type: "json" };

const api = process.env.SOFTMAX_API_URL ?? "https://softmax.com/api";

const whoamiSchema = z.object({
  subject_id: z.string(),
  subject_type: z.string(),
  user_email: z.email(),
  name: z.string().nullable().optional(),
});

const uploadSchema = z.object({
  upload_url: z.url().nullable().optional(),
  existing_policy_version: z.object({ id: z.string() }).nullable().optional(),
});

const policyVersionSchema = z.object({ id: z.string(), name: z.string(), version: z.number() });
const xpSchema = z.object({ id: z.string(), status: z.string() });
const submissionSchema = z.object({
  id: z.string(), status: z.string(), created_at: z.string().optional(),
  auto_champion: z.string().optional(),
  policy_version: z.object({ id: z.string() }).optional(),
  player: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
});
const playerSchema = z.object({ id: z.string(), name: z.string(), is_default: z.boolean(), disabled_at: z.string().nullable().optional() });
const versionPlayerRow = z.object({ policy_version_id: z.string(), player_id: z.string().nullable().optional(), player_name: z.string().nullable().optional() });
const versionPlayerPage = z.union([z.array(versionPlayerRow), z.object({ entries: z.array(versionPlayerRow) })]);

/** A Softmax player: the public identity that policy versions and league entries are credited to. */
export type SoftmaxPlayer = { id: string; name: string };
const submissionPageSchema = z.union([z.array(submissionSchema), z.object({ entries: z.array(submissionSchema) })]);
const leagueSchema = z.object({
  id: z.string(), name: z.string(), description: z.string().nullable(),
  rounds_paused_at: z.string().nullable(), submissions_locked_at: z.string().nullable(),
  settings: z.object({ ladder: z.object({ enabled: z.boolean() }) }),
});
const divisionSchema = z.object({ id: z.string(), name: z.string(), type: z.string() });
const policyLeaderboardSchema = z.array(z.object({
  rank: z.number(), policy_version_id: z.string(), policy_label: z.string(), player_id: z.string().nullable(),
  player_name: z.string().nullable(), score: z.number(), rounds_played: z.number(),
  wins: z.number(), episodes_played: z.number(), win_rate: z.number(),
})).nullable();
const experienceSchema = z.object({
  id: z.string(), requester_user_id: z.string(), status: z.string(),
  coworld_id: z.string(),
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
  scores: z.array(z.object({ policy_version_id: z.string(), score: z.number() })),
  created_at: z.string(), completed_at: z.string().nullable(),
});
const experiencePageSchema = z.object({ entries: z.array(experienceSchema), next_cursor: z.string().nullable() });
const experienceDetailSchema = experienceSchema.extend({ episodes: z.array(episodeSchema) });
const episodeRequestSummarySchema = z.object({
  id: z.string(), status: z.string(), coworld_id: z.string().nullable(), round_id: z.string().nullable(),
  replay_url: z.string().nullable(), policy_version_ids: z.array(z.string()), created_at: z.string(),
});
const episodeRequestPageSchema = z.object({ entries: z.array(episodeRequestSummarySchema), next_cursor: z.string().nullable() });
const participantSchema = z.object({
  position: z.number(), policy_version_id: z.string().optional(), policy_name: z.string().optional(),
  version: z.number().optional(), player_name: z.string().nullable().optional(),
});
const seatScoreSchema = z.object({ position: z.number(), score: z.number() });
const episodeResultSchema = z.object({
  id: z.string(), status: z.string(), error: z.string().nullable().optional(), replay_url: z.string().nullable().optional(),
  participants: z.array(participantSchema).nullable(), participant_scores: z.array(seatScoreSchema).nullable(),
});
const episodeRequestSchema = z.object({
  id: z.string(), status: z.string(), round_id: z.string().nullable(), coworld_id: z.string().nullable(),
  episode_id: z.string().nullable(), replay_url: z.string().nullable(), policy_version_ids: z.array(z.string()),
});
const roundPageSchema = z.object({ entries: z.array(z.object({ id: z.string(), round_number: z.number() })), next_cursor: z.string().nullable() });
const coachingAnalysisSummarySchema = z.object({ id: z.string(), status: z.string(), phase: z.string().nullable().optional(), error: z.string().nullable().optional() });
const coachingSessionSchema = z.object({
  id: z.string(), episode_id: z.string(), user_id: z.string(), coworld_name: z.string().nullable(),
  status: z.string(), created_at: z.string(), duration_ms: z.number().nullable(),
  latest_analysis: coachingAnalysisSummarySchema.nullable(),
  feed: z.object({
    summary: z.string().nullable(), quote: z.string().nullable(), insights: z.array(z.string()),
  }).nullable(),
  policy_reference: z.object({ policy_version_id: z.string().nullable(), slot: z.number().nullable() }),
});
const coachingSessionDetailSchema = coachingSessionSchema.extend({
  declared_context: z.string(), recording_url: z.string().nullable().optional(),
  timeline: z.array(z.object({ id: z.string(), kind: z.string(), at_ms: z.number(), payload: z.object({ text: z.string().optional() }).passthrough() })).optional(),
});
const coachingCreatedSchema = z.object({
  id: z.string(), upload: z.object({ url: z.url(), content_type: z.string() }),
});
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
  status: number;
  constructor(status: number, path: string, detail: string) {
    super(`Softmax ${path} returned ${status}: ${detail}`);
    this.status = status;
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

/** The player Softmax credits the caller's uploads and league entries to unless another is named. */
export async function getDefaultPlayer(token: string): Promise<SoftmaxPlayer | null> {
  const players = (await softmax("/players", token, z.array(playerSchema))).filter((player) => !player.disabled_at);
  const player = players.find((candidate) => candidate.is_default) ?? players[0];
  return player ? { id: player.id, name: player.name } : null;
}

/** The player Softmax recorded for one of the caller's policy versions, or null when none is assigned. */
export async function getPolicyVersionPlayer(token: string, policyVersionId: string): Promise<SoftmaxPlayer | null> {
  const params = new URLSearchParams({ mine: "true", policy_version_id: policyVersionId, limit: "1" });
  const page = await softmax(`/v2/policy-versions?${params}`, token, versionPlayerPage);
  const row = (Array.isArray(page) ? page : page.entries).find((entry) => entry.policy_version_id === policyVersionId);
  return row?.player_id && row.player_name ? { id: row.player_id, name: row.player_name } : null;
}

export async function getLeague(token: string) {
  return softmax(`/v2/leagues/${league.id}`, token, leagueSchema);
}

export async function getCompetitionDivision(token: string) {
  const divisions = await softmax(`/v2/divisions?league_id=${league.id}`, token, z.array(divisionSchema));
  const competition = divisions.find((division) => division.type === "competition");
  if (!competition) throw new Error("The Gods of the Arena league has no competition division");
  return competition;
}

export async function getPolicyLeaderboard(token: string, divisionId: string) {
  return softmax(`/v2/divisions/${divisionId}/policy-leaderboard?window_minutes=4320`, token, policyLeaderboardSchema);
}

export async function listLeagueSubmissions(token: string) {
  const entries: z.infer<typeof submissionSchema>[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ mine: "true", league_id: league.id, limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const page = await softmax(`/v2/league-submissions?${params}`, token,
      z.union([z.array(submissionSchema), z.object({ entries: z.array(submissionSchema), next_cursor: z.string().nullable().optional() })]));
    entries.push(...(Array.isArray(page) ? page : page.entries));
    cursor = Array.isArray(page) ? null : page.next_cursor ?? null;
  } while (cursor);
  return entries;
}

export async function listExperiences(token: string) {
  const experiences: z.infer<typeof experienceSchema>[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ mine: "true", league_id: league.id, limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const page = await softmax(`/v2/experience-requests?${params}`, token, experiencePageSchema);
    experiences.push(...page.entries);
    cursor = page.next_cursor;
  } while (cursor);
  return experiences;
}

/** One page of the episodes a policy version was scheduled into, newest first. Round episodes carry a round ID. */
export async function listPolicyVersionEpisodeRequests(token: string, policyVersionId: string, cursor?: string | null, limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return softmax(`/v2/policy-versions/${policyVersionId}/episode-requests?${params}`, token, episodeRequestPageSchema);
}

/** Seats and per-seat scores for up to 50 episode requests in one call. */
export async function getEpisodeResults(token: string, episodeRequestIds: string[]) {
  if (!episodeRequestIds.length) return [];
  const params = new URLSearchParams({ view: "results", limit: "200" });
  for (const id of episodeRequestIds) params.append("ids", id);
  const page = await softmax(`/v2/episode-requests?${params}`, token, z.object({ entries: z.array(episodeResultSchema) }));
  return page.entries;
}

export async function getEpisodeRequest(token: string, episodeRequestId: string) {
  return softmax(`/v2/episode-requests/${episodeRequestId}`, token, episodeRequestSchema);
}

// Round numbers never change once a round exists, so they are kept for the life of the server instance.
const leagueRounds = new Map<string, number>();

/** Round numbers for this league's rounds. IDs that belong to another league are left out. */
export async function leagueRoundNumbers(token: string, roundIds: string[]) {
  if (roundIds.some((id) => !leagueRounds.has(id))) {
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ league_id: league.id, limit: "200" });
      if (cursor) params.set("cursor", cursor);
      const page: z.infer<typeof roundPageSchema> = await softmax(`/v2/rounds?${params}`, token, roundPageSchema);
      for (const round of page.entries) leagueRounds.set(round.id, round.round_number);
      cursor = page.next_cursor;
    } while (cursor && roundIds.some((id) => !leagueRounds.has(id)));
  }
  return new Map(roundIds.filter((id) => leagueRounds.has(id)).map((id) => [id, leagueRounds.get(id)!]));
}

const replayViewerHost = /^(?:[a-z0-9-]+\.cloudfront\.net|softmax\.com|[a-z0-9-]+\.softmax\.com)$/;

/** Map an absolute viewer URL onto the first-party /replay-viewer proxy path. Unknown hosts pass through unchanged. */
export function proxiedViewerUrl(viewerUrl: string) {
  const url = new URL(viewerUrl);
  if (url.protocol !== "https:" || !replayViewerHost.test(url.hostname)) return viewerUrl;
  return `/replay-viewer/${url.hostname}${url.pathname}${url.search}${url.hash}`;
}

export async function createReplaySession(token: string, coworldId: string, replayUri: string) {
  const session = await softmax("/v2/coworlds/replays/session", token,
    z.object({ viewer_url: z.url(), ready: z.boolean() }),
    { coworld_id: coworldId, replay_uri: replayUri });
  return { ...session, viewer_url: proxiedViewerUrl(session.viewer_url) };
}

/**
 * Readiness for a viewer URL. Static replay viewers (CloudFront bundles) are ready as soon as
 * they are served; the legacy game-pod proxy exposes a healthz route that must report ready.
 */
export async function replaySessionReady(token: string, viewerUrl: string) {
  const pathname = new URL(viewerUrl, "https://softmax.com").pathname;
  const proxy = pathname.indexOf("/proxy/");
  if (proxy < 0) return { ready: true };
  const path = pathname.slice(pathname.indexOf("/v2/"), proxy);
  if (!/^\/v2\/coworlds\/replays\/[a-z0-9-]+\/sessions\/[0-9a-f-]+$/.test(path)) {
    throw new Error("Invalid replay session URL");
  }
  return softmax(`${path}/proxy/healthz`, token, z.object({ ready: z.boolean() }));
}

export async function getExperience(token: string, requestId: string) {
  return softmax(`/v2/experience-requests/${requestId}`, token, experienceDetailSchema);
}

export async function listCoachingSessions(token: string) {
  const sessions = await softmax("/v2/coaching-sessions?limit=30", token, z.array(coachingSessionSchema));
  return sessions.filter((session) => session.coworld_name === league.coworldName);
}

export async function getCoachingSession(token: string, sessionId: string) {
  return softmax(`/v2/coaching-sessions/${sessionId}`, token, coachingSessionDetailSchema);
}

export async function getCoachingAnalysis(token: string, sessionId: string, analysisId: string) {
  return softmax(`/v2/coaching-sessions/${sessionId}/analyses/${analysisId}`, token, coachingAnalysisSchema);
}

export async function createCoachingSession(token: string, input: {
  idempotency_key: string; episode_id: string; coworld_id: string;
  replay_uri: string; declared_context: string;
}) {
  return softmax("/v2/coaching-sessions", token, coachingCreatedSchema, {
    ...input, policy_version_id: null, slot: null,
  });
}

export async function appendCoachingEvents(token: string, sessionId: string, events: unknown[]) {
  return softmax(`/v2/coaching-sessions/${sessionId}/events`, token,
    z.object({ accepted: z.number(), skipped: z.number() }), { events });
}

export async function finishCoachingSession(token: string, sessionId: string, input: {
  duration_ms: number; tick_alignment: "available" | "unavailable";
  video: { bytes: number; sha256: string; mime: string };
}) {
  return softmax(`/v2/coaching-sessions/${sessionId}/finish`, token, coachingSessionDetailSchema, input);
}

export async function startCoachingAnalysis(token: string, sessionId: string, idempotencyKey: string) {
  return softmax(`/v2/coaching-sessions/${sessionId}/analyses`, token,
    z.object({ id: z.string(), status: z.string() }), { idempotency_key: idempotencyKey });
}

export async function getEpisodeStats(token: string, episodeId: string) {
  return softmax(`/v2/episode-requests/${episodeId}/episode-stats`, token, episodeStatsSchema);
}

/**
 * Build the Softmax policy name: a readable, kebab-case description of how the policy plays,
 * plus four characters derived from the student so two students can pick the same words.
 */
export function policyNameFor(subjectId: string, character: string) {
  const slug = character.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 35).replace(/-+$/g, "");
  const suffix = createHash("sha256").update(subjectId).digest("hex").slice(0, 4);
  return `${slug || "arena-hero"}-${suffix}`;
}

export function policyStyleFromSummary(summary: string) {
  const terms = [...new Set((summary.toLowerCase().match(/\b(?:towers?|forts?|lanes?|rangers?|vanguards?|berserkers?|hunters?|liches|lich|retreat|defend|push|farm|siege|kite|heal|draft|mid)\b/g) ?? []).map((term) => term === "liches" ? "lich" : term.replace(/s$/, "")))].slice(0, 2);
  return terms.length === 2 ? terms.join("-") : terms.length === 1 ? `${terms[0]}-focus` : "balanced-starter";
}

export async function uploadPolicy(token: string, subjectId: string, source: string, title: string, policyName?: string, playerId?: string) {
  const bytes = Buffer.from(source, "utf8");
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const name = policyName ?? policyNameFor(subjectId, "arena-hero");
  const body = {
    name,
    content_hash: contentHash,
    size_bytes: bytes.length,
    tags: { title: title.slice(0, 50), description: "Student policy edited in NeuralHub harness" },
    // Name the player explicitly so the version is credited to the one the student was shown.
    ...(playerId ? { player_id: playerId } : {}),
  };
  // The object store is content-addressed across policy names. A 409 means the bytes
  // are already present; /complete creates or reuses this student's policy version.
  let upload: z.infer<typeof uploadSchema>;
  try {
    upload = await softmax("/stats/policies/files/upload", token, uploadSchema, body);
  } catch (error) {
    if (!(error instanceof SoftmaxError && error.status === 409)) throw error;
    upload = { upload_url: null };
  }
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

export async function requestEpisode(token: string, policyVersionId: string, title: string, idempotencyKey = `neuralhub-${policyVersionId}`) {
  return softmax("/v2/experience-requests", token, xpSchema, {
    idempotency_key: idempotencyKey,
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
