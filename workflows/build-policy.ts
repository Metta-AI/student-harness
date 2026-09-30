import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Output, ToolLoopAgent } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { unseal } from "../lib/session";
import { requestEpisode, uploadPolicy } from "../lib/softmax";

const editSchema = z.object({
  before: z.string().min(8),
  after: z.string().min(8),
  summary: z.string().min(8).max(200),
});

async function editPolicy(request: string, previousSource?: string) {
  "use step";
  const source = previousSource ?? (await readFile(join(process.cwd(), "hero.bas"), "utf8"));
  const agent = new ToolLoopAgent({
    model: anthropic("claude-sonnet-5-5"),
    output: Output.object({ schema: editSchema }),
    instructions: `You improve a Gods of the Arena policy written in Polyworld BASIC.
Make one focused gameplay change. Return an exact substring from the source as "before" and its replacement as "after".
The substring must occur exactly once. Preserve the rest of the file. Do not use Python, Nim, external imports, or
functions absent from the source or the public policy guide. Treat replay coaching as an observation, especially when
its coached policy is unbound or differs from this file. Keep the policy under 64 KiB. Explain the change briefly.`,
  });
  const result = await agent.generate({
    prompt: `Student request: ${request}\n\nCurrent hero.bas:\n${source}`,
  });
  const { before, after, summary } = result.output;
  if (source.split(before).length !== 2) throw new Error("Agent edit did not match exactly one section of hero.bas");
  const edited = source.replace(before, after);
  if (Buffer.byteLength(edited, "utf8") > 64 * 1024) throw new Error("Edited policy exceeds the 64 KiB source limit");
  return { source: edited, summary };
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

export async function buildPolicy(sessionCipher: string, request: string, previousSource?: string) {
  "use workflow";
  const { source, summary } = await editPolicy(request, previousSource);
  const policy = await upload(sessionCipher, source, summary);
  const experience = await requestHostedEpisode(sessionCipher, policy.id, summary);
  return {
    source,
    summary,
    policyVersionId: policy.id,
    policyLabel: `${policy.name}:v${policy.version}`,
    xpRequestId: experience.id,
  };
}
