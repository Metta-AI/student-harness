import { createHash } from "node:crypto";
import { z } from "zod";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const spanSchema = z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), sha256: z.string().length(64), status: z.enum(["mapped", "stale"]) });
const ruleSchema = z.object({
  id: z.string().min(1), when: z.string().min(1), skill: z.string().min(1), for: z.array(z.string().min(1)).min(1),
  intent: z.string().min(1), source: spanSchema,
});
export const semanticIrSchema = z.object({
  schema: z.literal("gota-harness-semantic-ir/1"), id: z.string().min(1),
  situation: z.object({ authority: z.string(), predicates: z.record(z.string(), z.string()), unknowns: z.array(z.string()) }),
  belief: z.object({ claims: z.record(z.string(), z.object({ claim: z.string(), status: z.enum(["untested", "needs_review"]), evidence: z.array(z.string()) })) }),
  goal: z.record(z.string(), z.object({ claim: z.string(), provenance: z.enum(["authored", "interpretation"]) })),
  skill: z.record(z.string(), z.object({ operator: z.string(), intent: z.string() })),
  strategy: z.array(ruleSchema),
  execution: z.object({ binding: z.literal("gota-harness-source-map/1"), language: z.literal("Polyworld BASIC"), mode: z.literal("source_mapped_no_compiler"), source_sha256: z.string().length(64) }),
  update: z.object({ revision: z.number().int().nonnegative(), parent: z.string().nullable(), change: z.string(), evidence: z.array(z.string()), research_plan: z.object({ hypothesis: z.string(), expected: z.string(), non_trigger: z.string() }) }),
});
export type SemanticIR = z.infer<typeof semanticIrSchema>;
export type SourceSpan = z.infer<typeof spanSchema>;
export type PolicyRevision = { source: string; ir: SemanticIR; revisionId: string; receipts: { representation: "partial"; fidelity: "not_run"; validity: "not_run"; performance: "not_run"; notes: string[] } };

export const semanticChangeSchema = z.object({
  before: z.string().min(8), after: z.string().min(8), summary: z.string().min(8).max(200),
  semantic: z.object({ condition: z.string().min(8), action: z.string().min(8), goal: z.string().min(8),
    hypothesis: z.string().min(8), expected: z.string().min(8), non_trigger: z.string().min(8) }),
});
export type SemanticChange = z.infer<typeof semanticChangeSchema>;

function revision(source: string, ir: SemanticIR): PolicyRevision {
  semanticIrSchema.parse(ir);
  if (ir.strategy.length === 0) throw new Error("Semantic IR has no source-linked rules");
  const known = new Set(ir.strategy.map((rule) => rule.id));
  if (known.size !== ir.strategy.length) throw new Error("Duplicate semantic rule ID");
  for (const rule of ir.strategy) {
    if (rule.source.end <= rule.source.start || (rule.source.end > source.length && rule.source.status === "mapped")) {
      throw new Error(`Invalid source span for ${rule.id}`);
    }
    if (!(rule.when in ir.situation.predicates) || !(rule.skill in ir.skill) || rule.for.some((goal) => !(goal in ir.goal))) {
      throw new Error(`Unresolved semantic reference in ${rule.id}`);
    }
    if (rule.source.status === "mapped" && digest(source.slice(rule.source.start, rule.source.end)) !== rule.source.sha256) {
      throw new Error(`Source mapping changed for ${rule.id}`);
    }
  }
  if (ir.execution.source_sha256 !== digest(source)) throw new Error("Semantic IR does not match source bytes");
  return {
    source, ir,
    revisionId: digest(`${ir.update.parent ?? "root"}\n${digest(source)}\n${digest(JSON.stringify(ir))}`),
    receipts: { representation: "partial", fidelity: "not_run", validity: "not_run", performance: "not_run",
      notes: ["Source spans and references checked; whole-program semantic extraction is unavailable for this BASIC policy.",
        "Behavioral intent and hosted performance need independent checks."] },
  };
}

export function importPolicy(source: string, isStarter: boolean): PolicyRevision {
  const sections = isStarter ? [
    ["setup", "State and declarations", "Policy setup"], ["chooseHero", "Draft a team role", "Drafting"],
    ["learnAbilities", "Choose legal ability upgrades", "Progression"], ["readObject", "Read visible objects", "Observation"],
    ["observe", "Choose observed threats and opportunities", "Observation"], ["buy", "Buy available items", "Economy"],
    ["inventory", "Use and resupply items", "Economy"], ["dodgeWarnings", "Avoid observed danger", "Survival"],
    ["moveTo", "Move toward a chosen goal", "Movement"], ["spells", "Cast available abilities", "Combat"],
    ["main", "Coordinate combat, farming and pushing", "Victory"],
  ] as const : [["imported", "Imported executable; intent not reconstructed", "Unknown"]] as const;
  const names = sections.map(([name]) => name);
  const starts = names.map((name) => name === "setup" || name === "imported" ? 0 : name === "main" ? source.indexOf("\nif drafting then") : source.indexOf(`sub ${name}(`));
  if (starts.some((start, index) => index > 0 && start <= starts[index - 1]) || starts[0] !== 0) throw new Error("Starter policy source layout changed");
  if (isStarter) starts[starts.length - 1] += 1;
  const predicates: Record<string, string> = {};
  const goal: SemanticIR["goal"] = {};
  const skill: SemanticIR["skill"] = {};
  const strategy: SemanticIR["strategy"] = [];
  sections.forEach(([name, intent, purpose], index) => {
    const key = `R_${name}`;
    predicates[`P_${name}`] = isStarter ? `Source section ${name} is reached under its BASIC guards.` : "Unknown until source audit.";
    goal[`G_${name}`] = { claim: purpose, provenance: "interpretation" };
    skill[`S_${name}`] = { operator: isStarter ? name : "opaque_import", intent };
    const start = starts[index];
    const end = starts[index + 1] ?? source.length;
    strategy.push({ id: key, when: `P_${name}`, skill: `S_${name}`, for: [`G_${name}`], intent,
      source: { start, end, sha256: digest(source.slice(start, end)), status: "mapped" } });
  });
  return revision(source, { schema: "gota-harness-semantic-ir/1", id: "gota_hero",
    situation: { authority: "visible host state and BASIC source", predicates, unknowns: ["Unseen opponents and runtime effects are not inferred from source."] },
    belief: { claims: {} }, goal, skill, strategy,
    execution: { binding: "gota-harness-source-map/1", language: "Polyworld BASIC", mode: "source_mapped_no_compiler", source_sha256: digest(source) },
    update: { revision: 0, parent: null, change: isStarter ? "Imported official starter source with section-level interpretations." : "Imported existing source; semantic intent unknown.",
      evidence: [], research_plan: { hypothesis: "No gameplay change yet.", expected: "No behavioral claim.", non_trigger: "No intervention." } },
  });
}

export type SemanticFields = SemanticChange["semantic"];
export const semanticFieldsSchema = semanticChangeSchema.shape.semantic;

/** Apply one replaced span [start, end) -> after to the parent revision and record it as a new source-linked rule. */
function applySpan(parent: PolicyRevision, start: number, end: number, after: string, summary: string, semantic: SemanticFields, evidence: string[]): PolicyRevision {
  if (revision(parent.source, parent.ir).revisionId !== parent.revisionId) throw new Error("Parent revision changed since creation");
  const source = parent.source.slice(0, start) + after + parent.source.slice(end);
  if (source === parent.source) throw new Error("Semantic change did not modify BASIC source");
  if (after.length === 0) throw new Error("Replacement span must keep at least one character to link the rule to source");
  if (Buffer.byteLength(source, "utf8") > 64 * 1024) throw new Error("Edited policy exceeds the 64 KiB source limit");
  const delta = after.length - (end - start);
  const ir = structuredClone(parent.ir);
  for (const rule of ir.strategy) {
    const span = rule.source;
    if (span.status === "stale") continue;
    if (span.end <= start) continue;
    if (span.start >= end) { span.start += delta; span.end += delta; continue; }
    span.status = "stale";
  }
  const n = ir.update.revision + 1;
  const key = `R_change_${n}`;
  const predicate = `P_change_${n}`;
  const skill = `S_change_${n}`;
  const goal = `G_change_${n}`;
  const belief = `B_change_${n}`;
  ir.situation.predicates[predicate] = semantic.condition;
  ir.goal[goal] = { claim: semantic.goal, provenance: "authored" };
  ir.skill[skill] = { operator: "source_patch", intent: semantic.action };
  ir.belief.claims[belief] = { claim: semantic.hypothesis, status: "untested", evidence };
  ir.strategy.push({ id: key, when: predicate, skill, for: [goal], intent: semantic.action,
    source: { start, end: start + after.length, sha256: digest(after), status: "mapped" } });
  ir.execution.source_sha256 = digest(source);
  ir.update = { revision: n, parent: parent.revisionId, change: summary, evidence,
    research_plan: { hypothesis: semantic.hypothesis, expected: semantic.expected, non_trigger: semantic.non_trigger } };
  return revision(source, ir);
}

/** Reconcile a change expressed as one unique before/after substring pair. */
export function reconcilePolicy(parent: PolicyRevision, change: SemanticChange, evidence: string[]): PolicyRevision {
  const { before, after, summary, semantic } = semanticChangeSchema.parse(change);
  if (before === after) throw new Error("Semantic change did not modify BASIC source");
  const start = parent.source.indexOf(before);
  if (start < 0 || parent.source.indexOf(before, start + 1) >= 0) throw new Error("BASIC edit must match exactly one source span");
  return applySpan(parent, start, start + before.length, after, summary, semantic, evidence);
}

/**
 * Reconcile a whole new source text against the parent. The changed region is the
 * smallest window between the common prefix and suffix, widened to whole lines so the
 * new rule links to readable source even for deletions.
 */
export function reconcileSource(parent: PolicyRevision, nextSource: string, summary: string, semantic: SemanticFields, evidence: string[]): PolicyRevision {
  const old = parent.source;
  if (old === nextSource) throw new Error("hero.bas is unchanged since the last saved revision");
  let prefix = 0;
  const max = Math.min(old.length, nextSource.length);
  while (prefix < max && old[prefix] === nextSource[prefix]) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && old[old.length - 1 - suffix] === nextSource[nextSource.length - 1 - suffix]) suffix++;
  // Widen to whole lines.
  let start = old.lastIndexOf("\n", prefix - 1) + 1;
  let oldEnd = old.indexOf("\n", old.length - suffix);
  oldEnd = oldEnd < 0 ? old.length : oldEnd + 1;
  let newEnd = nextSource.length - (old.length - oldEnd);
  // A pure deletion can leave an empty replacement; grow the window one line at a time.
  while (newEnd <= start && (start > 0 || oldEnd < old.length)) {
    if (start > 0) start = old.lastIndexOf("\n", start - 2) + 1;
    else { const next = old.indexOf("\n", oldEnd); oldEnd = next < 0 ? old.length : next + 1; }
    newEnd = nextSource.length - (old.length - oldEnd);
  }
  const after = nextSource.slice(start, newEnd);
  return applySpan(parent, start, oldEnd, after, summary, semanticFieldsSchema.parse(semantic), evidence);
}

/**
 * Record the parent's source unchanged as a new revision: the baseline a student uploads before
 * changing anything. Keeps every source link, bumps the revision, and records the intent.
 */
export function baselineRevision(parent: PolicyRevision, summary: string, semantic: SemanticFields, evidence: string[]): PolicyRevision {
  if (revision(parent.source, parent.ir).revisionId !== parent.revisionId) throw new Error("Parent revision changed since creation");
  const ir = structuredClone(parent.ir);
  const n = ir.update.revision + 1;
  ir.belief.claims[`B_baseline_${n}`] = { claim: semantic.hypothesis, status: "untested", evidence };
  ir.update = { revision: n, parent: parent.revisionId, change: summary, evidence,
    research_plan: { hypothesis: semantic.hypothesis, expected: semantic.expected, non_trigger: semantic.non_trigger } };
  return revision(parent.source, ir);
}
