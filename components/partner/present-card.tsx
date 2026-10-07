"use client";

import { useState, type ReactNode } from "react";
import { ArrowUpRight, History, X } from "lucide-react";
import { CompanionControls, ScreenShareButton, TalkButton, useCompanion } from "./companion";
import type { TaskFeed } from "../tasks/use-task-feed";
import { PrestonOrb } from "./preston-orb";
import { campaignCompanion, companionPrompts } from "../../lib/partner/companion-summary";

export function PresentPanel({ expanded, busy, activity, feed, waiting, navigationDisabled, onClose, onOpenSession, onType, onHistory, onPrompt, currentView='performance', typingOpen=false, children }: {
  expanded: boolean; busy: boolean; activity: string | null; feed: TaskFeed; waiting: number;
  navigationDisabled: boolean; onClose: () => void; onOpenSession?: (id:string)=>void;
  onType?:()=>void; onHistory?:()=>void; onPrompt?:(text:string)=>void; currentView?:string; typingOpen?:boolean; children: ReactNode;
}) {
  const { phase, micPaused, backgroundWorking, speaking, historyLoading } = useCompanion();
  const [campaignId,setCampaignId]=useState('');
  const campaign=feed.campaigns.find(c=>c.id===campaignId)??feed.campaigns.find(c=>!['completed','canceled','failed'].includes(c.state))??feed.campaigns[0];
  const summary=campaignCompanion(campaign,feed.tasks,!!feed.error);
  const status=micPaused?'Take your time. Your microphone is paused.':phase==='connecting'?'Let’s get voice connected…':speaking?'Talking it through with you…':phase==='listening'?'I’m listening. What’s on your mind?':busy||backgroundWorking?activity??'Let me take a look…':summary.status??(waiting?'I’m waiting for our test results.':'Ready to explore together.');
  const working=busy||backgroundWorking;
  const open=(id:string)=>onOpenSession?onOpenSession(id):window.location.assign(`/sessions/${id}`);
  return <aside id="present-panel" className={`present-panel conversing companion-friendly${expanded?' expanded':''}`} aria-label="Preston">
    <div className="present-panel-heading"><button type="button" className="present-panel-close" onClick={onClose} aria-label="Back to workspace"><X size={17}/></button></div>
    <section className={`present-avatar-card${working?' is-busy':''}${phase==='listening'?' is-listening':''}${speaking?' is-speaking':''}`} aria-label="Preston companion">
      <div className="present-portrait" aria-hidden="true"><PrestonOrb motion={phase!=='off'||working} busy={speaking||working}/></div>
      <div className="present-avatar-identity"><span className="companion-eyebrow">Your research companion</span><h2>Preston</h2>
        {campaign?<button className="companion-status-link" disabled={navigationDisabled} onClick={()=>open(campaign.task_id)}><span role="status">{status}</span><ArrowUpRight size={13}/></button>:<p role="status">{status}</p>}
      </div>
      {onHistory?<button className="companion-history-button" type="button" title="Conversation history" aria-label="Conversation history" disabled={navigationDisabled} onClick={onHistory}><History size={17}/></button>:null}
    </section>
    <div className="companion-invitation"><TalkButton disabled={navigationDisabled||historyLoading}/><ScreenShareButton disabled={navigationDisabled}/>{onType?<button className="companion-type-button" disabled={navigationDisabled} onClick={onType} aria-expanded={typingOpen} aria-controls="present-chat">{typingOpen?'Hide keyboard':'Type instead'}</button>:null}</div>
    <CompanionControls showTranscript={!onType}/>
    {campaign?<section className="companion-finding" aria-label="Campaign update">
      <header><span>{summary.finding?'What I’m finding':'What we’re exploring'}</span>{feed.campaigns.length>1?<select aria-label="Preston campaign" value={campaign.id} disabled={navigationDisabled} onChange={e=>setCampaignId(e.target.value)}>{feed.campaigns.map(c=><option key={c.id} value={c.id}>{c.objective.slice(0,100)}</option>)}</select>:null}</header>
      <p>{summary.finding??summary.title}</p>
      <footer><span>{feed.error?'Last saved update':`Cycle ${campaign.cycle+1}`}</span><button className="text-button" disabled={navigationDisabled} onClick={()=>open(summary.sourceId??campaign.task_id)}>{summary.sourceId?'Read finding':'Explore campaign'}<ArrowUpRight size={13}/></button></footer>
    </section>:<p className="companion-intro">Bring a question, a replay, or an idea. We’ll work through it together.</p>}
    {onPrompt?<div className="companion-starters" aria-label="Explore with Preston">{companionPrompts(currentView,!!campaign,!!summary.finding).map(prompt=><button key={prompt.label} disabled={navigationDisabled||busy} onClick={()=>onPrompt(`${prompt.text}${campaign?`\nCampaign: ${campaign.id}.`:''}`)}>{prompt.label}<ArrowUpRight size={12}/></button>)}</div>:null}
    {children}
  </aside>;
}
