"use client";

import { type ReactNode } from "react";
import { ArrowUpRight, History, MessageCircle, X } from "lucide-react";
import { CompanionControls, ScreenShareButton, TalkButton, useCompanion } from "./companion";
import type { TaskFeed } from "../tasks/use-task-feed";
import { PrestonOrb } from "./preston-orb";
import { CameraPreview } from "./camera-preview";
import { usePanelWidth } from "./use-panel-width";
import { campaignCompanion, companionPrompts } from "../../lib/partner/companion-summary";

export function PresentPanel({ expanded, busy, activity, feed, waiting, navigationDisabled, onClose, onOpenSession, onType, onHistory, onPrompt, currentView='performance', labMode=false, typingOpen=false, children }: {
  expanded: boolean; busy: boolean; activity: string | null; feed: TaskFeed; waiting: number;
  navigationDisabled: boolean; onClose: () => void; onOpenSession?: (id:string)=>void;
  onType?:()=>void; onHistory?:()=>void; onPrompt?:(text:string)=>void; currentView?:string; labMode?:boolean; typingOpen?:boolean; children: ReactNode;
}) {
  const { panel, separator } = usePanelWidth();
  const { phase, micPaused, backgroundWorking, speaking, historyLoading } = useCompanion();
  const campaign=feed.campaigns.find(c=>!['completed','canceled','failed'].includes(c.state))??feed.campaigns[0];
  const summary=campaignCompanion(campaign,feed.tasks,!!feed.error);
  const status=micPaused?'Take your time. Your microphone is paused.':phase==='connecting'?'Let’s get voice connected…':speaking?'Talking it through with you…':phase==='listening'?'I’m listening. What’s on your mind?':busy||backgroundWorking?activity??'Let me take a look…':summary.status??(waiting?'I’m waiting for our test results.':'Ready to explore together.');
  const working=busy||backgroundWorking;
  const open=(id:string)=>onOpenSession?onOpenSession(id):window.location.assign(`/sessions/${id}`);
  return <aside ref={panel} id="present-panel" className={`present-panel conversing companion-friendly${expanded?' expanded':''}`} aria-label="Preston">
    <div className="preston-resize-handle" {...separator}/>
    <div className="present-panel-heading"><button type="button" className="present-panel-close" onClick={onClose} aria-label="Back to workspace"><X size={17}/></button></div>
    <section className={`present-avatar-card${working?' is-busy':''}${phase==='listening'?' is-listening':''}${speaking?' is-speaking':''}`} aria-label="Preston companion">
      <div className="present-portrait" aria-hidden="true"><PrestonOrb motion={phase!=='off'||working} busy={speaking||working}/></div>
      <div className="present-avatar-identity"><h2>Preston</h2>
        {labMode||phase!=="off"||working?<p role="status">{status}</p>:null}
      </div>
      {onHistory?<button className="companion-history-button" type="button" title="Conversation history" aria-label="Conversation history" disabled={navigationDisabled} onClick={onHistory}><History size={17}/></button>:null}
    </section>
    <div className="companion-invitation"><TalkButton disabled={navigationDisabled||historyLoading}/><ScreenShareButton disabled={navigationDisabled}/><CameraPreview disabled={navigationDisabled}/>{onType?<button type="button" className="companion-type-button" disabled={navigationDisabled} onClick={onType} aria-label={typingOpen?'Hide chat':'Show chat'} title={typingOpen?'Hide chat':'Show chat'} aria-expanded={typingOpen} aria-controls="present-chat"><MessageCircle size={19} aria-hidden="true"/></button>:null}</div>
    <CompanionControls showTranscript={!onType}/>
    {campaign?<section className="companion-finding" aria-label="Campaign update">
      <header><span>{summary.finding?'What I’m finding':'What we’re exploring'}</span></header>
      <p>{summary.finding??summary.title}</p>
      <footer><span>{feed.error?'Last saved update':'Research update'}</span><button className="text-button" disabled={navigationDisabled} onClick={()=>open(summary.sourceId??campaign.task_id)}>Inspect in Lab<ArrowUpRight size={13}/></button></footer>
    </section>:null}
    {labMode&&onPrompt?<div className="companion-starters" aria-label="Explore with Preston">{companionPrompts(currentView,!!campaign,!!summary.finding).map(prompt=><button key={prompt.label} disabled={navigationDisabled||busy} onClick={()=>onPrompt(`${prompt.text}${campaign?`\nCampaign: ${campaign.id}.`:''}`)}>{prompt.label}<ArrowUpRight size={12}/></button>)}</div>:null}
    {children}
  </aside>;
}
