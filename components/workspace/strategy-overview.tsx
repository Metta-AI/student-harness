"use client";
import { useEffect, useState } from "react";
import type { PolicyRevision } from "../../lib/semantic-ir";
export function StrategyOverview({ revision, branchId, onSource, onDiscuss }: { revision: PolicyRevision; branchId?: string; onSource: (branch: string) => void; onDiscuss?: (text: string) => void }) {
  const { ir } = revision;
  const [selected, setSelected] = useState(branchId ?? ir.strategy[0]?.id ?? "");
  useEffect(() => { if (branchId) setSelected(branchId); }, [branchId]);
  const rule = ir.strategy.find(r => r.id === selected) ?? ir.strategy[0];
  return <section className="strategy-overview" aria-label="Policy strategy overview">
    <div className="workspace-section-heading"><div><span className="eyebrow">Policy strategy · r{ir.update.revision}</span><h2>When to act, and why</h2><p>{ir.update.change}</p></div></div>
    <p className="evidence-caption">Source-linked policy intent. These branches are not a recorded execution trace.</p>
    <div className="strategy-branches" role="group" aria-label="Choose a strategy branch">{ir.strategy.map(r => <button type="button" key={r.id} aria-pressed={rule?.id === r.id} onClick={() => setSelected(r.id)}>{r.id.replace(/^R_/, "").replaceAll("_", " ")}</button>)}</div>
    {rule ? <><div className="decision-flow" aria-label="Situation to action">
      <article><span>Situation</span><strong>{ir.situation.predicates[rule.when] ? ir.situation.predicates[rule.when] : rule.when}</strong></article><span className="flow-arrow" aria-hidden="true">→</span>
      <article className="decision-intent"><span>Decision</span><strong>{rule.intent}</strong></article><span className="flow-arrow" aria-hidden="true">→</span>
      <article><span>Action</span><strong>{ir.skill[rule.skill]?.intent ?? rule.skill}</strong></article>
    </div><div className="strategy-evidence"><div><span className="eyebrow">Source evidence</span><p>{rule.source.status === "mapped" ? `hero.bas · lines ${revision.source.slice(0, rule.source.start).split("\n").length}–${revision.source.slice(0, Math.max(rule.source.start, rule.source.end - 1)).split("\n").length} · r${ir.update.revision}` : "Source changed since this branch was mapped."}</p></div><button type="button" className="secondary" onClick={() => onSource(rule.id)}>Inspect source ↗</button></div>
    {onDiscuss ? <button className="text-button" onClick={() => onDiscuss(`Inspect branch ${rule.id} in revision r${ir.update.revision}: ${rule.intent}. Show the supporting source and any replay evidence in your pane. Explain what would test or disprove its expected behavior, and investigate if useful.`)}>Explore this decision with Preston ↗</button> : null}</> : <p>No strategy branches mapped for this revision yet.</p>}
  </section>;
}
