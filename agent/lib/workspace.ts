import type { SandboxSession } from "eve/sandbox";
import starterSource from "../../hero.bas?raw";
import { listExperiments, listPolicyVersionsWithSource, type ExperimentRow, type PolicyVersionRow } from "../../lib/db";
import { importPolicy, type PolicyRevision } from "../../lib/semantic-ir";

export const starter = (): PolicyRevision => importPolicy(starterSource, true);

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export async function run(sandbox: SandboxSession, command: string) {
  const result = await sandbox.run({ command });
  if (result.exitCode !== 0) throw new Error(`${command}\n${result.stderr || result.stdout}`.slice(0, 2000));
  return result.stdout;
}

export function versionNote(version: Pick<PolicyVersionRow, "revision_number" | "revision_id" | "parent_revision_id" | "summary" | "evidence" | "softmax_policy_version_id" | "softmax_policy_label" | "created_at">, ir: PolicyRevision["ir"], experiments: ExperimentRow[]) {
  return {
    revision: version.revision_number,
    revision_id: version.revision_id,
    parent_revision_id: version.parent_revision_id,
    summary: version.summary,
    hypothesis: ir.update.research_plan,
    evidence: version.evidence,
    softmax_policy_version_id: version.softmax_policy_version_id,
    softmax_policy_label: version.softmax_policy_label,
    created_at: version.created_at,
    hosted_games: experiments.map((experiment) => ({
      xp_request_id: experiment.xp_request_id, title: experiment.title, status: experiment.status,
      episodes: experiment.episodes.map((episode) => ({ id: episode.id, status: episode.status, our_scores: episode.our_scores, participant_scores: episode.participant_scores })),
    })),
  };
}

/** Write one revision's files into the workspace and commit it. */
export async function commitVersion(sandbox: SandboxSession, version: PolicyVersionRow, experiments: ExperimentRow[]) {
  const ir = version.ir as PolicyRevision["ir"];
  const name = `r${version.revision_number}`;
  await sandbox.writeTextFile({ path: "hero.bas", content: version.source });
  await sandbox.writeTextFile({ path: `versions/${name}.bas`, content: version.source });
  await sandbox.writeTextFile({ path: `versions/${name}.json`, content: JSON.stringify(versionNote(version, ir, experiments), null, 2) + "\n" });
  await run(sandbox, `cd /workspace && git add -A && git -c user.name=arena -c user.email=arena@softmax.local commit -q --allow-empty -m ${shellQuote(`${name}: ${version.summary}`)} && git tag -f ${name} >/dev/null`);
}

export async function writeExperiment(sandbox: SandboxSession, experiment: ExperimentRow) {
  await sandbox.writeTextFile({ path: `experiments/${experiment.xp_request_id}.json`, content: JSON.stringify(experiment, null, 2) + "\n" });
}

/**
 * Rebuild /workspace from the student's saved history: the starter policy as revision 0, one
 * commit per saved revision, and one JSON file per hosted game already checked.
 */
export async function hydrateWorkspace(sandbox: SandboxSession, subjectId: string | null) {
  await run(sandbox, "mkdir -p /workspace/versions /workspace/experiments && cd /workspace && git init -q 2>/dev/null || true");
  const versions = subjectId ? await listPolicyVersionsWithSource(subjectId) : [];
  const experiments = subjectId ? await listExperiments(subjectId) : [];
  const base = starter();
  const root: PolicyVersionRow = {
    id: "starter", student_id: subjectId ?? "", revision_number: 0, revision_id: base.revisionId, parent_revision_id: null,
    summary: "Official starter policy", source: base.source, ir: base.ir, receipts: base.receipts, evidence: [],
    softmax_policy_version_id: null, softmax_policy_label: null, created_at: new Date(0).toISOString(),
  };
  await commitVersion(sandbox, root, []);
  for (const version of versions) {
    await commitVersion(sandbox, version, experiments.filter((experiment) => experiment.policy_version_id === version.id));
  }
  for (const experiment of experiments) await writeExperiment(sandbox, experiment);
  await sandbox.writeTextFile({ path: "STATUS.md", content: [
    `# Workspace status`, ``,
    `Student: ${subjectId ?? "(local development, no student)"}`,
    `Saved revisions: ${versions.length} (working copy is r${versions.at(-1)?.revision_number ?? 0})`,
    `Hosted games checked: ${experiments.length}`,
    ``, `See WORKSPACE.md for the layout.`, ``,
  ].join("\n") });
}
