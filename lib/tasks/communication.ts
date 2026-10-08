/** Shared writing contract for saved session reports and Preston's spoken/text updates. */
export const humanCommunicationInstructions = `Write for the human and preserve a separate exact handoff for agents.
Lead human-facing messages with what happened in gameplay or research terms, why it matters for improving league performance, and what happens next. Use short, natural sentences. Explain technical terms when they matter. Say "our current best policy", "the proposed change", "a fair comparison", or "the recorded game version" when the exact identifier is irrelevant to the decision.
Never recite UUIDs, source hashes, release fingerprints, raw tool names or storage paths in human-facing prose. Keep exact identifiers, source/release identities, episode/tick references, counterexamples and machine-readable structures in evidence, artifacts, components and the full technical summary. Link to evidence with descriptive labels.
For structured session results, include humanSummary: { outcome, whyItMatters, nextStep }. Each field is one or two concise sentences. outcome states the finding or blocker; whyItMatters explains the consequence for the policy or confidence in it; nextStep states the next useful action, or that no action is needed. Do not invent a planned action or imply it is already queued. Completed research is not proof of improvement or deployment. Distinguish a proposed change, an untested change, a measured result and a league submission. State uncertainty and failed tests plainly. A blocked test is not a losing policy. Ask the human only when their input is actually required.
Progress summaries use this same plain language; put exact resumable context in evidence. When speaking or chatting, translate tool/session outputs into this style rather than reading the raw handoff. Supply technical detail when the user asks for it.`;

type HumanSummary = { outcome: string; whyItMatters: string; nextStep: string };
export function humanSummaryOf(value: unknown): HumanSummary | null {
  if (!value || typeof value !== 'object') return null;
  const report = (value as Record<string, unknown>).humanSummary;
  if (!report || typeof report !== 'object') return null;
  const fields = report as Record<string, unknown>;
  if (!['outcome', 'whyItMatters', 'nextStep'].every(key => typeof fields[key] === 'string' && (fields[key] as string).trim())) return null;
  return { outcome: readableText(fields.outcome as string), whyItMatters: readableText(fields.whyItMatters as string), nextStep: readableText(fields.nextStep as string) };
}

/** Display-only fallback for older reports. Never modifies saved evidence or agent context. */
export function readableText(text: string): string {
  // Keep Markdown destinations exact while making their visible labels readable.
  return text.split(/(\[[^\]]*\]\([^)]*\)|https?:\/\/[^\s<>]+)/g).map(part => {
    if (/^https?:\/\//.test(part)) return `[Evidence](${part})`;
    const link = part.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
    if (link) return `[${readableText(link[1])}](${link[2]})`;
    return part
      .replace(/\bchampion\s+`?[0-9a-f]{8}-[0-9a-f-]{27,}`?(?:,?\s*source\s+`?[0-9a-f]{32,128}`?)?(?:,?\s*on\s+release\s+`?[0-9a-f]{32,128}`?)?/gi, 'our current best policy')
      .replace(/\bblocked before candidate validation\b/gi, 'the proposed policy could not be tested yet')
      .replace(/\b(?:source(?: hash)?|release(?: fingerprint)?)\s*[:=]?\s*`?[0-9a-f]{32,128}`?/gi, 'the recorded version')
      .replace(/`?\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`?/gi, 'a saved reference')
      .replace(/`?\b[0-9a-f]{32,128}\b`?/gi, 'a recorded fingerprint')
      .replace(/\b(?:league|xreq|wrun)_[a-zA-Z0-9_-]+\b/g, 'the saved record')
      .replace(/\bcandidate validation\b/gi, 'testing the proposed policy')
      .replace(/\bincumbent\b/gi, 'current best policy');
  }).join('').trim();
}

export function resultPreview(result: unknown): string {
  const report = humanSummaryOf(result);
  if (report) return `${report.outcome} ${report.whyItMatters}`;
  const summary = typeof result === 'string' ? result : result && typeof result === 'object' ? (result as Record<string, unknown>).summary : null;
  return typeof summary === 'string' ? readableText(summary) : '';
}

export function studyHumanSummary(result: { pairs: number; baselineWins: number; candidateWins: number; passed: boolean }, cohort: string): HumanSummary {
  const confirmation = cohort === 'confirmation';
  return {
    outcome: `In ${result.pairs} matched games per policy, the proposed policy won ${result.candidateWins} and our current best policy won ${result.baselineWins}.`,
    whyItMatters: result.passed
      ? confirmation ? 'The improvement met the confirmation test’s requirements. This result alone does not mean the policy is live in the league.' : 'The change passed the initial comparison, but still needs independent testing before we can rely on it.'
      : 'The change did not meet this test’s improvement requirements. These results do not justify replacing our current policy.',
    nextStep: result.passed
      ? confirmation ? 'Check the campaign’s deployment decision to see whether the tested policy was submitted.' : 'Confirm the result on new games before considering a league submission.'
      : 'Use the replay evidence to understand the result and choose what to test next.',
  };
}
