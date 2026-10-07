"use client";
import { ResearchWorkbench } from "./research-workbench";
import { useState } from "react";
import { ArrowRight, ArrowUpRight, GitBranch, Play, Plus, RotateCcw } from "lucide-react";
import { taskPhases, taskStatuses, type TaskFeed } from "../tasks/use-task-feed";

import {LearningSketch} from "./learning-sketch";

const steps = [
  { id: "watch", name: "Watch", note: "Find a moment", question: "What actually happened?" },
  { id: "question", name: "Question", note: "Form a hypothesis", question: "What might explain it?" },
  { id: "try", name: "Try", note: "Change one thing", question: "What could we test?" },
  { id: "compare", name: "Compare", note: "Check the evidence", question: "Did our idea hold up?" },
] as const;
type Experiment = { xpRequestId: string; title: string; status: string; revision: number | null; completedGames: number; score: number | null };

export function LearningWorkspace({ feed, revision, experiments, replay, onWatch, onNavigate, onNew, onTask, onDiscuss, onVersion }: {
  feed: TaskFeed; revision: number | null; experiments: Experiment[]; replay: string | null;
  onWatch: () => void; onNavigate: (view: "policy" | "episodes" | "together") => void;
  onVersion?: (revision: number) => void;
  onNew: () => void; onTask: (id: string) => void; onDiscuss: (text: string) => void;
}) {
  const [selected, setSelected] = useState<(typeof steps)[number]["id"]>("watch");
  const step = steps.find(s => s.id === selected)!;
  const completed = experiments.filter(e => e.status === "completed");
  const recent = completed[0];
  return <section className="learning-workspace" aria-label="Explore and experiment">
    <header className="learning-heading"><h1>Policy experiments</h1></header>
    <ResearchWorkbench onDiscuss={onDiscuss} onTask={onTask} onVersion={onVersion} />
    <div className="learning-loop" role="group" aria-label="Choose a step in the learning loop">
      {steps.map((item, index) => <div className="learning-stop" key={item.id}><button data-present-action="click" type="button" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><LearningSketch kind={item.id} /><span className="learning-step-name"><small>0{index + 1}</small>{item.name}</span><span className="learning-step-note">{item.note}</span></button>{index < 3 ? <ArrowRight className="learning-connector" size={19} aria-hidden="true" /> : null}</div>)}
      <div className="learning-return" aria-hidden="true"><span /><RotateCcw size={13} /><span /></div>
    </div>
    <div className={`learning-evidence evidence-${selected}`} aria-live="polite">
      <div className="evidence-paper-icon" aria-hidden="true">{selected === "watch" ? <Play size={21} /> : selected === "question" ? <GitBranch size={23} /> : selected === "try" ? <Plus size={24} /> : <RotateCcw size={22} />}</div>
      <div className="learning-evidence-copy"><span className="notebook-label">{step.name} with Preston</span><h2>{step.question}</h2>
        <p>{selected === "watch" ? replay ? `Start with ${replay}. Pause on a decision you want to understand.` : "Open a replay and inspect a decision." : selected === "question" ? "Connect a situation to an action. Keep the evidence beside the idea." : selected === "try" ? revision ? `Our starting point is revision ${revision}. Make one focused change and test it.` : "Create a policy, then test one change." : recent ? `${recent.title}${recent.revision ? ` · revision ${recent.revision}` : ""}. ${recent.completedGames} completed hosted game${recent.completedGames === 1 ? "" : "s"} to inspect.` : "Compare the behavior we expected with what the game actually shows."}</p>
        <button type="button" data-present-action="click" onClick={() => selected === "watch" ? onWatch() : selected === "question" ? onNavigate("together") : selected === "try" ? onNavigate("policy") : onNavigate("episodes")}>{selected === "watch" ? replay ? "Open the replay" : "Find a game to watch" : selected === "question" ? "Explore our hypotheses" : selected === "try" ? "Open our policy" : "Inspect the results"}<ArrowUpRight size={15} /></button>
      </div>
    </div>
    <div className="learning-invitation"><button type="button" onClick={() => onDiscuss("Help me explore one moment from our GoTA games. Read our latest recorded results and shared hypotheses, then help me connect an observation to one testable idea. If we have no replay yet, help me choose a first experiment.")}>Discuss an observation <ArrowUpRight size={14} /></button></div>
    <details className="learning-work"><summary><span>Experiments & work</span><small>{feed.error ? "Unavailable" : feed.loaded ? `${feed.tasks.length} recorded` : "Loading…"}</small></summary>
      {feed.error ? <p role="status">Work could not be loaded. <button type="button" onClick={() => void feed.refresh()}>Retry</button></p> : null}
      {feed.tasks.map(task => <button type="button" data-present-action="click" className="learning-work-item" key={task.id} onClick={() => onTask(task.id)}><div><strong>{task.objective}</strong><span>{taskPhases[task.phase]}</span></div><small>{taskStatuses[task.status]} <ArrowUpRight size={12} /></small></button>)}
      <button type="button" className="learning-new-experiment" onClick={onNew}><Plus size={14} />Start an experiment</button>
    </details>
  </section>;
}
