import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { sealJson, unsealJson } from "./crypto";
import type { PolicyRevision } from "./semantic-ir";

let client: SupabaseClient | undefined;

/** Server-only Supabase client. The service key never reaches the browser. */
export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${what}: no data`);
  return result.data;
}

// ---------- students ----------

export async function upsertStudent(input: { subjectId: string; email: string; token: string }) {
  const result = await db().from("students").upsert({
    subject_id: input.subjectId,
    email: input.email,
    sealed_token: sealJson({ token: input.token }),
    updated_at: new Date().toISOString(),
  }, { onConflict: "subject_id" });
  if (result.error) throw new Error(`upsert student: ${result.error.message}`);
}

/** The student's Softmax token, unsealed. Throws when the student never signed in to the web app. */
export async function studentToken(subjectId: string): Promise<string> {
  const result = await db().from("students").select("sealed_token").eq("subject_id", subjectId).maybeSingle();
  if (result.error) throw new Error(`load student: ${result.error.message}`);
  if (!result.data) throw new Error("This student has not signed in to the arena web app yet");
  return z.object({ token: z.string().min(1) }).parse(unsealJson(result.data.sealed_token)).token;
}

// ---------- policy versions ----------

const policyVersionRow = z.object({
  id: z.string(), student_id: z.string(), revision_number: z.number(), revision_id: z.string(),
  parent_revision_id: z.string().nullable(), summary: z.string(), source: z.string(),
  ir: z.unknown(), receipts: z.unknown(), evidence: z.array(z.string()),
  softmax_policy_version_id: z.string().nullable(), softmax_policy_label: z.string().nullable(),
  created_at: z.string(),
});
export type PolicyVersionRow = z.infer<typeof policyVersionRow>;
const versionColumns = "id, student_id, revision_number, revision_id, parent_revision_id, summary, source, ir, receipts, evidence, softmax_policy_version_id, softmax_policy_label, created_at";
const versionListColumns = "id, student_id, revision_number, revision_id, parent_revision_id, summary, evidence, softmax_policy_version_id, softmax_policy_label, created_at";

export function toRevision(row: PolicyVersionRow): PolicyRevision {
  return { source: row.source, ir: row.ir as PolicyRevision["ir"], revisionId: row.revision_id, receipts: row.receipts as PolicyRevision["receipts"] };
}

export async function listPolicyVersions(studentId: string): Promise<Omit<PolicyVersionRow, "source" | "ir" | "receipts">[]> {
  const rows = must(await db().from("policy_versions").select(versionListColumns).eq("student_id", studentId).order("revision_number", { ascending: true }), "list versions");
  return z.array(policyVersionRow.omit({ source: true, ir: true, receipts: true })).parse(rows);
}

export async function listPolicyVersionsWithSource(studentId: string): Promise<PolicyVersionRow[]> {
  const rows = must(await db().from("policy_versions").select(versionColumns).eq("student_id", studentId).order("revision_number", { ascending: true }), "list versions");
  return z.array(policyVersionRow).parse(rows);
}

export async function latestPolicyVersion(studentId: string): Promise<PolicyVersionRow | null> {
  const result = await db().from("policy_versions").select(versionColumns).eq("student_id", studentId).order("revision_number", { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new Error(`latest version: ${result.error.message}`);
  return result.data ? policyVersionRow.parse(result.data) : null;
}

export async function policyVersionByRevision(studentId: string, revisionNumber: number): Promise<PolicyVersionRow | null> {
  const result = await db().from("policy_versions").select(versionColumns).eq("student_id", studentId).eq("revision_number", revisionNumber).maybeSingle();
  if (result.error) throw new Error(`load version: ${result.error.message}`);
  return result.data ? policyVersionRow.parse(result.data) : null;
}

export async function policyVersionBySoftmaxId(studentId: string, softmaxPolicyVersionId: string): Promise<PolicyVersionRow | null> {
  const result = await db().from("policy_versions").select(versionColumns).eq("student_id", studentId).eq("softmax_policy_version_id", softmaxPolicyVersionId).maybeSingle();
  if (result.error) throw new Error(`load version: ${result.error.message}`);
  return result.data ? policyVersionRow.parse(result.data) : null;
}

export async function insertPolicyVersion(input: { studentId: string; revision: PolicyRevision; summary: string; evidence: string[] }): Promise<PolicyVersionRow> {
  const { revision } = input;
  const row = must(await db().from("policy_versions").insert({
    student_id: input.studentId,
    revision_number: revision.ir.update.revision,
    revision_id: revision.revisionId,
    parent_revision_id: revision.ir.update.parent,
    summary: input.summary,
    source: revision.source,
    ir: revision.ir,
    receipts: revision.receipts,
    evidence: input.evidence,
  }).select(versionColumns).single(), "insert version");
  return policyVersionRow.parse(row);
}

export async function markPolicyUploaded(id: string, softmax: { policyVersionId: string; label: string }) {
  const result = await db().from("policy_versions").update({ softmax_policy_version_id: softmax.policyVersionId, softmax_policy_label: softmax.label }).eq("id", id);
  if (result.error) throw new Error(`mark uploaded: ${result.error.message}`);
}

// ---------- experiments ----------

const episodeSummary = z.object({
  id: z.string(), status: z.string(), job_index: z.number().nullable(), replay_url: z.string().nullable(),
  our_scores: z.array(z.number()), participant_scores: z.array(z.object({ position: z.number(), score: z.number() })),
  completed_at: z.string().nullable(), error: z.string().nullable(),
});
const experimentRow = z.object({
  id: z.string(), student_id: z.string(), policy_version_id: z.string(), xp_request_id: z.string(), title: z.string(),
  hypothesis: z.string().nullable(), status: z.string(), episodes: z.array(episodeSummary),
  summary: z.unknown().nullable(), created_at: z.string(), completed_at: z.string().nullable(),
});
export type ExperimentRow = z.infer<typeof experimentRow>;
export type EpisodeSummary = z.infer<typeof episodeSummary>;

export async function insertExperiment(input: { studentId: string; policyVersionRowId: string; xpRequestId: string; title: string; hypothesis?: string; status: string }): Promise<ExperimentRow> {
  const row = must(await db().from("experiments").upsert({
    student_id: input.studentId, policy_version_id: input.policyVersionRowId, xp_request_id: input.xpRequestId,
    title: input.title, hypothesis: input.hypothesis ?? null, status: input.status,
  }, { onConflict: "xp_request_id" }).select("*").single(), "insert experiment");
  return experimentRow.parse(row);
}

export async function updateExperiment(xpRequestId: string, patch: { status: string; episodes: EpisodeSummary[]; summary?: unknown; completed_at?: string | null }) {
  const result = await db().from("experiments").update(patch).eq("xp_request_id", xpRequestId);
  if (result.error) throw new Error(`update experiment: ${result.error.message}`);
}

export async function listExperiments(studentId: string, policyVersionRowId?: string): Promise<ExperimentRow[]> {
  let query = db().from("experiments").select("*").eq("student_id", studentId).order("created_at", { ascending: false });
  if (policyVersionRowId) query = query.eq("policy_version_id", policyVersionRowId);
  return z.array(experimentRow).parse(must(await query, "list experiments"));
}

export async function experimentByXp(studentId: string, xpRequestId: string): Promise<ExperimentRow | null> {
  const result = await db().from("experiments").select("*").eq("student_id", studentId).eq("xp_request_id", xpRequestId).maybeSingle();
  if (result.error) throw new Error(`load experiment: ${result.error.message}`);
  return result.data ? experimentRow.parse(result.data) : null;
}

// ---------- chat sessions ----------

const chatRow = z.object({ session_id: z.string(), student_id: z.string(), title: z.string().nullable(), created_at: z.string(), updated_at: z.string(), archived_at: z.string().nullable() });
export type ChatSessionRow = z.infer<typeof chatRow>;

export async function listChatSessions(studentId: string): Promise<ChatSessionRow[]> {
  const rows = must(await db().from("chat_sessions").select("*").eq("student_id", studentId).is("archived_at", null).order("updated_at", { ascending: false }).limit(50), "list chats");
  return z.array(chatRow).parse(rows);
}

export async function upsertChatSession(input: { studentId: string; sessionId: string; title?: string }): Promise<ChatSessionRow> {
  const existing = await db().from("chat_sessions").select("*").eq("session_id", input.sessionId).maybeSingle();
  if (existing.error) throw new Error(`load chat: ${existing.error.message}`);
  if (existing.data && existing.data.student_id !== input.studentId) throw new Error("This chat belongs to another student");
  const row = must(await db().from("chat_sessions").upsert({
    session_id: input.sessionId, student_id: input.studentId,
    title: input.title ?? existing.data?.title ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: "session_id" }).select("*").single(), "upsert chat");
  return chatRow.parse(row);
}

export async function archiveChatSession(studentId: string, sessionId: string) {
  const result = await db().from("chat_sessions").update({ archived_at: new Date().toISOString() }).eq("session_id", sessionId).eq("student_id", studentId);
  if (result.error) throw new Error(`archive chat: ${result.error.message}`);
}

// ---------- workspace files (optimizer lab persistence) ----------

const workspaceFileRow = z.object({ path: z.string(), content: z.string(), sha256: z.string(), updated_at: z.string() });
export type WorkspaceFileRow = z.infer<typeof workspaceFileRow>;

export async function listWorkspaceFiles(studentId: string): Promise<WorkspaceFileRow[]> {
  const rows = must(await db().from("workspace_files").select("path, content, sha256, updated_at").eq("student_id", studentId).order("path"), "list workspace files");
  return z.array(workspaceFileRow).parse(rows);
}

export async function upsertWorkspaceFiles(studentId: string, files: { path: string; content: string; sha256: string }[]) {
  if (!files.length) return;
  const result = await db().from("workspace_files").upsert(files.map((file) => ({ student_id: studentId, ...file, updated_at: new Date().toISOString() })), { onConflict: "student_id,path" });
  if (result.error) throw new Error(`upsert workspace files: ${result.error.message}`);
}

export async function deleteWorkspaceFiles(studentId: string, paths: string[]) {
  if (!paths.length) return;
  const result = await db().from("workspace_files").delete().eq("student_id", studentId).in("path", paths);
  if (result.error) throw new Error(`delete workspace files: ${result.error.message}`);
}
