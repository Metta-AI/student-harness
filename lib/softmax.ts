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
