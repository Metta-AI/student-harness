import { defineHook, type HookContext } from "eve/hooks";
import { studentFromAuth } from "../lib/student";
import { syncLabFiles } from "../lib/workspace";
import { createHash } from "node:crypto";
import { deleteWorkspaceFiles, latestPolicyVersion, upsertWorkspaceFiles, workspaceFile } from "../../lib/db";
import { z } from "zod";
import { trackServer } from "../../lib/analytics-server";
import { events } from "../../lib/analytics-events";

async function persist(ctx: HookContext) {
  const student = studentFromAuth(ctx.session.auth);
  if (!student) return;
  const sandbox = await ctx.getSandbox();
  const result = await syncLabFiles(sandbox, student.subjectId);
  const source = await sandbox.readTextFile({ path: "hero.bas" });
  const base = z.object({ revisionId: z.string(), sourceSha256: z.string() }).parse(JSON.parse((await sandbox.readTextFile({ path: "CURRENT_REVISION.json" }))!));
  const saved = await latestPolicyVersion(student.subjectId);
  if (source !== null && source !== saved?.source && createHash("sha256").update(source).digest("hex") !== base.sourceSha256) {
    await upsertWorkspaceFiles(student.subjectId, [
      { path: "draft/hero.bas", content: source, sha256: createHash("sha256").update(source).digest("hex") },
      { path: "draft/parent.txt", content: base.revisionId, sha256: createHash("sha256").update(base.revisionId).digest("hex") },
    ]);
  } else {
    const draft = await workspaceFile(student.subjectId, "draft/hero.bas");
    if (draft && draft.content === saved?.source) await deleteWorkspaceFiles(student.subjectId, ["draft/hero.bas", "draft/parent.txt"]);
  }
  if (result.synced) await trackServer(student.subjectId, events.labSynced, result);
}

/** Preserve policy drafts and optimizer memory after completed, failed, or canceled turns. */
export default defineHook({ events: {
  "turn.completed": (_event, ctx) => persist(ctx),
  "turn.failed": (_event, ctx) => persist(ctx),
  "turn.cancelled": (_event, ctx) => persist(ctx),
} });
