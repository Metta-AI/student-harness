"use client";

import { Play } from "lucide-react";
import type { LeagueStanding } from "../../lib/softmax";
import type { Task } from "../../lib/tasks/model";
import { humanIssues } from "../../lib/tasks/human-issues";
import { reviewSuggestions, type ReviewReplay } from "../../lib/workspace/coaching-home";
import { CoachingClips, type CoachingRecording, type CoachingDiscussion } from "./coaching-clips";

export function CoachingHome({ standings, activePlayerId, activePolicyId, currentPolicyLabel, record, replays, sessions, tasks, loading, stale, replayLoading, replayError, coachingLoaded, coachingError, onReplay, onDiscuss, onRefresh, onInspectTask }: {
  standings:LeagueStanding[]; activePlayerId?:string; activePolicyId:string; currentPolicyLabel:string;
  record:{games:number;time_limits:number}|null; replays:ReviewReplay[]; sessions:CoachingRecording[]; tasks:Task[];
  coachingLoaded:boolean; coachingError:string; loading:boolean; stale:boolean; replayLoading:boolean; replayError:string;
  onReplay:(replay:ReviewReplay)=>void; onDiscuss:CoachingDiscussion; onRefresh:()=>void; onInspectTask:(id:string)=>void;
}) {
  const active = standings.find(player=>player.player_id===activePlayerId);
  const suggestions = reviewSuggestions(replays);
  const primary = record && record.time_limits > record.games / 2 ? suggestions.find(replay=>replay.outcome==="time_limit")??suggestions[0] : suggestions[0];
  const scopedSessions = sessions.filter(session=>session.policy_reference?.policy_version_id===activePolicyId&&!!activePolicyId||replays.some(replay=>replay.episodeId===session.episode_id));
  const issues = humanIssues(tasks);
  const questions = issues.filter(issue=>issue.kind==="question").slice(0,3);
  const blockers = issues.filter(issue=>issue.kind!=="question");
  return <div className="human-workspace">
    <section className="human-standing" aria-label="Current policy and standing">
      <div><h1>Your policy</h1><p>{loading?"Loading…":currentPolicyLabel||"No league policy yet"}</p></div>
      <div className="human-rank"><strong>{active?.rank?`#${active.rank}`:"—"}</strong><span>{active?.rank?`of ${standings.length}`:"Unranked"}</span>{active?<small>{active.score.toFixed(2)} {active.score_label??"MMR"}</small>:null}</div>
    </section>
    {stale?<p className="human-status" role="status">Some results couldn’t refresh. <button className="text-button" onClick={onRefresh}>Retry</button></p>:null}
    {blockers.length?<section className="human-blockers" aria-label="Research blockers">{blockers.map(issue=><div key={issue.key}><p>{issue.text}{issue.taskIds.length>1?<small>{issue.taskIds.length} sessions affected</small>:null}</p><button className="text-button" onClick={()=>onInspectTask(issue.taskIds[0])}>Inspect in Lab ↗</button></div>)}</section>:null}
    {questions.length?<section className="human-questions" aria-label="Preston needs your input"><h2>Preston needs your input</h2>{questions.map(question=><article key={question.key}><p>{question.text}</p><button className="secondary" onClick={()=>onDiscuss("I’d like to help answer your open question.",{kind:"research-question",task_id:question.taskIds[0],related_task_ids:JSON.stringify(question.taskIds),hint:"Read task_status, explain the question in plain language, and ask for my input. Do not resume or change the task until we have clarified my answer."})}>Answer Preston ↗</button></article>)}</section>:null}
    <section className="human-next" aria-label="Suggested coaching">
      <h2>{primary?"Review this replay":"Next step"}</h2>
      {primary?<article><div className="human-replay-label"><Play size={18}/><span>{primary.label}{primary.outcome?` · ${primary.outcome==="lost"?"Loss":primary.outcome==="won"?"Win":"Time limit"}`:""}{primary.opponents?` · vs ${primary.opponents}`:""}</span></div><p>{primary.question}</p><button className="human-primary" onClick={()=>onReplay(primary)}>Watch & coach ↗</button></article>
        :replayError?<p role="status">Replays couldn’t load. <button className="text-button" onClick={onRefresh}>Retry replays</button></p>
        :replayLoading?<p role="status">Loading replays…</p>
        :<article><p>No replay to review yet.</p><button className="human-primary" onClick={()=>onDiscuss("Help me get a playable replay of my policy so I can coach it. Check whether a game is already running before proposing the next step.")}>Ask Preston for a replay ↗</button></article>}
    </section>
    {coachingError?<p className="human-status" role="status">Saved clips couldn’t load. <button className="text-button" onClick={onRefresh}>Retry clips</button></p>:coachingLoaded&&scopedSessions.length?<CoachingClips sessions={scopedSessions} onDiscuss={onDiscuss}/>:null}
  </div>;
}
