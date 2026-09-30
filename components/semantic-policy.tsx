"use client";

import { useState } from "react";
import type { PolicyRevision } from "../lib/semantic-ir";
import { BasicCode } from "./basic-code";

export function SemanticPolicy({ revision }: { revision: PolicyRevision }) {
  const { ir } = revision;
  const [selectedId, setSelectedId] = useState("");
  const selected = ir.strategy.find((rule) => rule.id === selectedId) ?? ir.strategy.at(-1);
  const span = selected?.source.status === "mapped" ? selected.source : undefined;
  const lineNumber = (offset: number) => revision.source.slice(0, offset).split("\n").length;

  return <div className="policy-pair">
    <section className="semantic-pane" aria-label="Semantic policy">
      <div className="semantic-heading"><span className="eyebrow">Semantic IR</span><strong>Intent ↔ execution</strong>
        <p>Strategy is linked to the exact BASIC version shown here. Source links are checked; gameplay behavior still needs replay evidence.</p></div>
      <div className="semantic-receipts"><span>Representation · partial</span><span>Behavior · unverified</span><span>Runtime · unverified</span><span>Performance · unverified</span></div>
      <div className="semantic-layers">
        <details><summary>Situation <small>{Object.keys(ir.situation.predicates).length} conditions</small></summary><p>{ir.situation.authority}</p><p>{ir.situation.unknowns.join(" ")}</p></details>
        <details><summary>Belief <small>{Object.keys(ir.belief.claims).length} hypotheses</small></summary>{Object.entries(ir.belief.claims).map(([id, claim]) => <p key={id}><b>{id}</b> · {claim.claim} · {claim.status}</p>)}{Object.keys(ir.belief.claims).length === 0 ? <p>No gameplay hypotheses recorded yet.</p> : null}</details>
        <details><summary>Goal <small>{Object.keys(ir.goal).length} goals</small></summary>{Object.entries(ir.goal).map(([id, goal]) => <p key={id}><b>{id}</b> · {goal.claim}</p>)}</details>
        <details><summary>Skill <small>{Object.keys(ir.skill).length} actions</small></summary>{Object.entries(ir.skill).map(([id, skill]) => <p key={id}><b>{id}</b> · {skill.intent}</p>)}</details>
        <div className="strategy-list"><div className="strategy-title">Strategy <small>{ir.strategy.length} source links</small></div>
          {ir.strategy.map((rule) => <button type="button" key={rule.id} className={`strategy-rule${selected?.id === rule.id ? " active" : ""}`} onClick={() => setSelectedId(rule.id)}>
            <span><b>{rule.id.replace(/^R_/, "").replaceAll("_", " ")}</b><small>{rule.source.status === "mapped" ? `L${lineNumber(rule.source.start)}–${lineNumber(Math.max(rule.source.start, rule.source.end - 1))}` : "Changed since mapping"}</small></span>
            <span>{rule.intent}</span>
          </button>)}</div>
        <details><summary>Execution <small>Polyworld BASIC</small></summary><p>Source SHA-256: <code>{ir.execution.source_sha256}</code></p><p>Binding: source map, no compiler.</p></details>
        <details><summary>Update <small>Revision {ir.update.revision}</small></summary><p>{ir.update.change}</p><p>Hypothesis: {ir.update.research_plan.hypothesis}</p><p>Expected: {ir.update.research_plan.expected}</p><p>Non-trigger: {ir.update.research_plan.non_trigger}</p><p>Evidence: {ir.update.evidence.length ? ir.update.evidence.join(", ") : "None yet"}</p></details>
      </div>
    </section>
    <section className="symbolic-pane" aria-label="Symbolic BASIC policy">
      <div className="symbolic-heading"><span>Symbolic · hero.bas</span><span>{revision.source.split("\n").length} lines</span></div>
      <BasicCode source={revision.source} selected={span} onSelectOffset={(offset) => {
        const rule = [...ir.strategy].reverse().find((item) => item.source.status === "mapped" && item.source.start <= offset && offset < item.source.end);
        if (rule) setSelectedId(rule.id);
      }} />
    </section>
  </div>;
}
