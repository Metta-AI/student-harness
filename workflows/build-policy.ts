import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Output, ToolLoopAgent } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { unseal } from "../lib/session";
import { requestEpisode, uploadPolicy } from "../lib/softmax";
import { importPolicy, reconcilePolicy, semanticChangeSchema, type PolicyRevision } from "../lib/semantic-ir";

async function editPolicy(request: string, previousRevision?: PolicyRevision, previousSource?: string) {
  "use step";
  const parent = previousRevision ?? importPolicy(previousSource ?? await readFile(join(process.cwd(), "hero.bas"), "utf8"), !previousSource);
  const agent = new ToolLoopAgent({
    model: anthropic("claude-sonnet-5-5"),
    output: Output.object({ schema: semanticChangeSchema }),
    instructions: `You improve a Gods of the Arena policy written in Polyworld BASIC.
Make one focused gameplay change. Return an exact, unique substring as "before" and its replacement as "after".
Also return the semantic condition, action, goal, falsifiable hypothesis, expected behavior and a non-trigger case.
The semantic fields describe the change you actually made, not a wish list. Preserve the rest of the file.
Do not use Python, Nim, external imports, or functions absent from the source or public policy guide.
Treat replay coaching as an observation, especially when its coached policy differs from this file.
Do not claim the behavior or competitive result has been verified. Keep the policy under 64 KiB.`,
  });
  const result = await agent.generate({
    prompt: `Student request and any replay evidence: ${request}\n\nCurrent semantic IR (source mappings may be stale; source is authoritative for execution):\n${JSON.stringify(parent.ir)}\n\nCurrent hero.bas:\n${parent.source}`,
  });
  const evidence = [...request.matchAll(/\[(coaching-session:csn_[0-9a-f-]{36}|replay-note:ereq_[0-9a-f-]{36}:xreq_[0-9a-f-]{36})\]/g)].map((match) => match[1]);
  return { revision: reconcilePolicy(parent, result.output, evidence), summary: result.output.summary };
}

async function upload(sessionCipher: string, source: string, summary: string) {
  "use step";
  const session = unseal(sessionCipher);
  return uploadPolicy(session.token, session.subjectId, source, summary);
}

async function requestHostedEpisode(sessionCipher: string, policyVersionId: string, summary: string) {
  "use step";
  const session = unseal(sessionCipher);
  return requestEpisode(session.token, policyVersionId, summary);
}

export async function buildPolicy(sessionCipher: string, request: string, previousRevision?: PolicyRevision, previousSource?: string) {
  "use workflow";
  const { revision, summary } = await editPolicy(request, previousRevision, previousSource);
  const policy = await upload(sessionCipher, revision.source, summary);
  const experience = await requestHostedEpisode(sessionCipher, policy.id, summary);
  return {
    source: revision.source,
    summary,
    revision,
    policyVersionId: policy.id,
    policyLabel: `${policy.name}:v${policy.version}`,
    xpRequestId: experience.id,
  };
}
