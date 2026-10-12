"use client";
import {useExtremeGoal} from './use-extreme-goal';
import {ComposerRunButton} from './composer-run-button';
import {VoiceHistory} from '../partner/voice-history';
import {permissionOptions,researchModeOptions} from '../use-chat-settings';
import {workspaceRequestRoute} from '../../lib/workspace/request';
import {Check,Link as LinkIcon} from 'lucide-react';
import linkStyles from './request-link.module.css';
import {findingDiscussionInstructions} from '../../lib/companion/finding-discussion';
import {GameGuide} from './game-guide';
import {LeagueReplay} from './league-replays';
import {gameCapabilities,gameWorkspacePanels,supportsGamePanel} from '../../lib/workspace/game-capabilities';
import typography from './artifact-typography.module.css';
import panelSurface from './panel-surface.module.css';
import {useEffect,useRef,useState} from 'react';
import {useEveAgent} from 'eve/react';
import Markdown from 'react-markdown';
import {isInactiveSession} from '../../lib/chat-recovery';
import {usePersistentDraft} from '../use-persistent-draft';
import {agentModeOptions,useAgentMode} from '../use-agent-mode';
import remarkGfm from 'remark-gfm';
import {ChevronRight,LoaderCircle,Maximize2,Minimize2,RotateCcw,Sparkles} from 'lucide-react';
import {Textarea} from '@/components/ui/textarea';
import {SelectField} from '@/components/ui/select-field';
import {chatModels,modelLabels,isChatModel} from '../../lib/model-selection';
import {composerContext} from '../../lib/workspace/composer';
import {presentationInputSchema,type WorkspaceView} from '../../lib/workspace/presentation';
import {stripAgentBlocks} from '../chat-context';
import {initialSessionPanels,mergeSessionPanels,sessionWorkspaceSchema,viewPanel,visibleSessionPanels,researchResultReady,type SessionPanel} from '../../lib/workspace/session-panels';
import {ReplayLibrary} from './replay-library';
import {SessionReplay} from './session-replay';
import {SessionTabs} from './session-tabs';
import {workspaceViewStyle} from '../../lib/workspace/view-style';
import {panelKey,openSessionTabs,closeSessionTabs} from '../../lib/workspace/session-tabs';
import {replayFromPrompt} from '../../lib/workspace/replay-analysis';
import {SessionActivity} from './session-activity';
import composerStyles from './composer-controls.module.css';
import activityStyles from './session-activity.module.css';
import {SessionTerminal} from './session-terminal';
import {SessionLiveStatus} from './session-live-status';
import {useSessionControl} from './use-session-control';
import {codingWorkspacePanels,codingWorkspaceInstructions} from '../../lib/workspace/coding-workspace';
import {SessionApp} from './session-app';
import {workspaceTemplates} from '../../lib/workspace/templates';
import {SessionResearch} from './session-research';
import {useSessionResearch} from './use-session-research';
import {SessionPolicy,type SessionPolicyContext} from './session-policy';
import {sessionProgress} from '../../lib/workspace/session-progress';
import {SessionEvidence} from './presentation-pane';
import type {ChatSettings} from '../use-chat-settings';
import type {TaskFeed} from '../tasks/use-task-feed';
import type {WorkspaceRequest} from './use-workspace-requests';

const canvasInstructions=workspaceViewStyle+' Use compose_workspace to arrange named tabs for this session’s purpose: replay coaching can combine an embedded replay, analysis and policy evidence; research can combine finished findings and measured experiment results. Only surface informative evidence with a clear conclusion and a useful human next step. Never create placeholder views or tabs for paused, queued, running or empty jobs; their status belongs in the conversation and Lab. Research task tabs appear only after completion with a saved result. Only use IDs returned by tools. Existing tabs are retained; stable IDs update a tab. The current tab list is in sessionWorkspace. This request owns an immersive Workspace with a conversation rail and an interactive result canvas. Keep conversational updates concise. All canvas tabs are compact working tools: lead with evidence, controls and a useful next action. No slogans, decorative hero headers, redundant league labels or large empty cards. Collapse general explanations and reference material. Deliver useful visual evidence with create_view or present_view using the current presentation.requestToken; these render directly in the canvas. Use a relevant existing view when possible. For research, check existing work and return the actual task or campaign receipt. Ask necessary questions in this conversation. No screen sharing is needed. Do not describe hidden workers or claim work succeeded without a tool receipt.';
const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;


/** The conversation's permanent address: the same /s/ link the history uses,
 * made absolute so it can be pasted anywhere and opened in the web app. */
function ConversationLink({request,leagueId}:{request:WorkspaceRequest;leagueId:string}){
  const [copied,setCopied]=useState(false);
  if(!request.shortId)return null;
  const path=workspaceRequestRoute(request,leagueId);
  const href=typeof window==='undefined'?path:new URL(path,window.location.origin).href;
  return <div className={linkStyles.row}>
    <span className={linkStyles.label} title={href}>Conversation {request.shortId}</span>
    <button type="button" className={linkStyles.action} aria-label="Copy link to this conversation" title={href} onClick={()=>{void navigator.clipboard.writeText(href).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1500);});}}>{copied?<Check size={12} aria-hidden="true"/>:<LinkIcon size={12} aria-hidden="true"/>}{copied?'Copied':'Copy link'}</button>
    <a className={linkStyles.action} href={href} target="_blank" rel="noreferrer" title="Open this conversation in the web app">Open ↗</a>
  </div>;
}
export function RequestWorkspace({request,leagueId,leagueName,settings,feed,policyContext,visible,onUpdate,onLab,onRecordingChange,accountId}:{accountId?:string;request:WorkspaceRequest;leagueId:string;leagueName:string;settings:ChatSettings;feed:TaskFeed;policyContext:SessionPolicyContext;visible:boolean;onUpdate:(id:string,patch:Partial<WorkspaceRequest>)=>void;onLab:(id?:string)=>void;onRecordingChange?:(active:boolean)=>void}){
  const policyExecution=gameCapabilities(leagueId).basicPolicyWorkspace;
  const [recording,setRecording]=useState(false);
  const policyId=policyContext.policyId??request.policyId;
  useEffect(()=>{if(!request.policyId&&policyId)onUpdate(request.id,{policyId});},[request.policyId,policyId,request.id,onUpdate]);
  const [draft,setDraft]=usePersistentDraft(`request:${request.id}`);
  const [,setAgentDefault]=useAgentMode();
  const [error,setError]=useState(''),[requestedAt,setRequestedAt]=useState(Date.now),[sending,setSending]=useState(false),[mobilePane,setMobilePane]=useState<'result'|'conversation'>('result'),[expanded,setExpanded]=useState(false),[refresh,setRefresh]=useState(0),[savedError,setSavedError]=useState(false);
  const [tabs,setTabs]=useState<SessionPanel[]>(()=>policyExecution?initialSessionPanels(request.tabs??(request.mode==='research'?codingWorkspacePanels:undefined),request.view):(request.tabs??gameWorkspacePanels()).filter(panel=>supportsGamePanel(leagueId,panel)));
  const [activeTabId,setActiveTabId]=useState(()=>request.activeTabId??request.tabs?.[0]?.id??(request.mode==='research'?'coding-terminal':request.view?viewPanel(request.view).id:'policy-context'));
  const tabState=useRef({tabs,activeTabId});tabState.current={tabs,activeTabId};
  const [closedTabs,setClosedTabs]=useState<string[]>(request.closedTabs??[]);
  const closedState=useRef(closedTabs);closedState.current=closedTabs;
  const research=useSessionResearch(tabs,feed.tasks,leagueId,accountId,refresh);
  const researchTasks=research.tasks;
  const availableTabs=visibleSessionPanels(tabs,researchTasks).filter(panel=>supportsGamePanel(leagueId,panel));
  const visibleTabs=openSessionTabs(availableTabs,closedTabs);
  const hiddenTabs=closedTabs.flatMap(key=>availableTabs.filter(panel=>panelKey(panel)===key));
  const activePanel=visibleTabs.find(t=>t.id===activeTabId)??visibleTabs.find(t=>t.kind!=='policy')??visibleTabs[0];
  const view=activePanel?.kind==='view'?activePanel.view:undefined;
  const acceptPanels=(incoming:SessionPanel[],selected?:string,title?:string)=>{
    incoming=incoming.filter(panel=>supportsGamePanel(leagueId,panel));
    if(!incoming.length)return;
    const unchanged=incoming.every(panel=>tabState.current.tabs.some(old=>JSON.stringify(old)===JSON.stringify(panel)));
    const next=mergeSessionPanels(tabState.current.tabs,incoming);
    const candidate=selected??(request.template?tabState.current.activeTabId:incoming.at(-1)?.id)??tabState.current.activeTabId;
    const target=next.find(panel=>panel.id===candidate);
    const active=target&&closedState.current.includes(panelKey(target))?tabState.current.activeTabId:candidate;
    if(unchanged&&active===tabState.current.activeTabId&&(!title||title===request.workspaceTitle))return;
    tabState.current={tabs:next,activeTabId:active};setTabs(next);setActiveTabId(active);
    onUpdate(request.id,{tabs:next,activeTabId:active,...title?{workspaceTitle:title}:{}});setMobilePane('result');
  };
  const selectPanel=(id:string)=>{if(recording)return;tabState.current.activeTabId=id;setActiveTabId(id);onUpdate(request.id,{activeTabId:id});};
  const closePanels=(ids:string[])=>{
    if(recording)return;
    const next=closeSessionTabs(availableTabs,closedState.current,activePanel?.id??'',ids);
    closedState.current=next.closed;setClosedTabs(next.closed);tabState.current.activeTabId=next.activeId;setActiveTabId(next.activeId);
    onUpdate(request.id,{tabs:tabState.current.tabs,closedTabs:next.closed,activeTabId:next.activeId});
  };
  const reopenPanel=(id:string)=>{
    if(recording)return;
    const panel=tabState.current.tabs.find(item=>item.id===id);if(!panel)return;
    const next=closedState.current.filter(key=>key!==panelKey(panel));closedState.current=next;setClosedTabs(next);
    tabState.current.activeTabId=id;setActiveTabId(id);onUpdate(request.id,{tabs:tabState.current.tabs,closedTabs:next,activeTabId:id});
  };
  const [taskId,setTaskId]=useState<string>();
  const [queued,setQueued]=useState(false);
  const token=useRef(request.token),started=useRef(!!request.sessionId),lastPrompt=useRef(request.prompt),sendLock=useRef(false),seen=useRef(new Set<string>(request.appliedToolCallIds??[])),end=useRef<HTMLDivElement>(null);
  const followLatest=useRef(true);
  const [readingHistory,setReadingHistory]=useState(false);
  const initialSession=useRef(request.sessionId);
  const terminalGrant=useRef(request.terminalGrantId??crypto.randomUUID());
  const workspace=useRef<HTMLElement>(null);
  const saveQueue=useRef(Promise.resolve());
  const [saveAttempt,setSaveAttempt]=useState(0);
  useEffect(()=>{
    if(!request.sessionId)return;
    let active=true;
    // Serialize metadata writes so a slower earlier turn cannot overwrite its successor.
    const timer=setTimeout(()=>{saveQueue.current=saveQueue.current.catch(()=>{}).then(async()=>{
      try{
        const response=await fetch('/api/chats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:request.sessionId,title:request.prompt.slice(0,80),workspaceRequest:{...request,leagueId}}),signal:AbortSignal.timeout(12000)});
        if(active)setSavedError(!response.ok);
        if(response.ok){const saved=(await response.json()).chat?.workspace_request;if(saved?.shortId&&saved.shortId!==request.shortId)onUpdate(request.id,{shortId:saved.shortId});}
      }catch{if(active)setSavedError(true);}
    });},500);
    return()=>{active=false;clearTimeout(timer);};
  },[request,leagueId,saveAttempt]);
  const agent=useEveAgent({
    ...(initialSession.current?{initialSession:{sessionId:initialSession.current,streamIndex:0},resume:true}:{}),
    onSessionChange:session=>{if(session&&session.sessionId!==request.sessionId)onUpdate(request.id,{sessionId:session.sessionId});},
    onError:err=>setError(err.message),
    onEvent:event=>{
      if(event.type==='message.received'){setError('');if(typeof event.data.message==='string')lastPrompt.current=event.data.message;}
      if(event.type==='session.failed'){retired.current=true;setRetiredNotice(true);setError('');}
      else if(event.type==='turn.failed'&&!retired.current)setError(event.data.message??'Preston couldn’t finish this request.');
    },
  });
  const live=useRef(agent);live.current=agent;
  const retired=useRef(false);const [retiredNotice,setRetiredNotice]=useState(false);
  const sendGeneration=useRef(0);
  const progressState=sessionProgress(agent.events,agent.status,!started.current);
  const streamBusy=progressState.working||agent.status==='submitted'||agent.status==='streaming';
  const turnKey=agent.events.filter(event=>event.type==='turn.started'||event.type==='message.received').at(-1)?.meta?.id??'';
  const control=useSessionControl({sessionId:request.sessionId,visible,working:streamBusy,settled:['complete','failed','stopped','ended'].includes(progressState.phase),turnKey,onTerminal:state=>{
    retired.current=state!=='waiting';setRetiredNotice(state==='failed');
    sendGeneration.current++;sendLock.current=false;setSending(false);
  }});
  const busy=sending||(!control.terminal&&!control.idle&&streamBusy);
  const goal=useExtremeGoal({sessionId:request.sessionId,visible,watch:settings.researchMode==='extreme'});
  const goalRunning=goal.state==='active'||goal.state==='queued'||goal.state==='credit_paused';
  const stopResponse=async()=>{await control.stop();goal.refresh();};
  const resumeResearch=async()=>{
    if(await goal.resume()){
      await control.check();
      await live.current.resume().catch(e=>setError(e.message));
    }
  };
  const reconnect=async()=>{await control.check();await live.current.resume().catch(e=>setError(e.message));};
  const runtimeFeedback={runtimeState:control.idle?'waiting' as const:control.runtimeState,stopping:control.stopping,stopAcknowledged:control.stopAcknowledged};
  // A long tool can outlive a stream connection. Reattach without submitting the request again.
  useEffect(()=>{
    if(!visible||!request.sessionId||(control.terminal||control.idle)||!progressState.working||agent.status!=='ready')return;
    let attaching=false;
    const timer=setInterval(()=>{
      if(attaching||document.visibilityState!=='visible')return;
      attaching=true;void live.current.resume().catch(()=>{}).finally(()=>{attaching=false;});
    },60000);
    return()=>clearInterval(timer);
  },[visible,request.sessionId,progressState.working,agent.status,control.terminal,control.idle]);
  const unavailable=recording||busy||goal.busy||control.stopping||(!control.terminal&&!control.idle&&agent.status==='resuming')||settings.modelSettingsSaving||!settings.modelSettingsReady;
  const context=()=>({...composerContext(request.mode,request.id,leagueId,policyId),surface:'request-workspace',agentMode:request.agentMode??'preston',...request.findingReference?.leagueId===leagueId?{findingReference:request.findingReference,findingDiscussionInstructions}:{},gameWorkspace:{leagueId,leagueName,capabilities:gameCapabilities(leagueId)},...request.mode==='research'?{terminalGrant:terminalGrant.current}:{},selectedPolicy:{id:policyId,label:policyContext.label,player:policyContext.player??null,summary:policyContext.summary??null},canvasInstructions:request.mode==='research'?codingWorkspaceInstructions:canvasInstructions+' For kind=app tabs, edit the declarative app in place using compose_workspace. Keep stable panel, section and input IDs so human values survive. App inputs and notes in sessionWorkspace are human-owned; never invent or overwrite them. Fill text blocks with grounded findings and references, and keep all app interactions self-contained. Use view blocks to load evidence inside the app automatically. Action targets open an in-app section or view; link to another tab only when essential. Never author prompt actions, modify the conversation composer, or send a chat message from an app button. Keep the app home selected during setup; add actual replays and evidence as supporting tabs. Template setup is read-only and never authorizes background work.',templateSetup:request.mode==='research'?codingWorkspaceInstructions:request.template?`For the initial app setup request: ${workspaceTemplates.find(t=>t.id===request.template?.id)?.setup??'Refine the existing app using available evidence.'} Enrich the app using compose_workspace; preserve its inputs and action IDs. If data is unavailable, explain what is missing and keep the app usable. Later follow-ups reflect the human’s new direction.`:null,sessionWorkspace:JSON.stringify({title:request.workspaceTitle,template:request.template,tabs:tabState.current.tabs,activeTabId:tabState.current.activeTabId,appValues:request.appValues,notes:request.notes,replayMoments:request.replayMoments,closedTabs:closedState.current}),presentation:{requestToken:token.current,human:{leagueId,policyId},pinned:false,view:view?.view??null}});
  // A terminal runtime cannot accept another turn. The conversation does not
  // end with it: the next message continues in a fresh session that inherits the
  // link, the opening goal and the transcript, and Preston picks up from there.
  const transcriptSoFar=()=>[...(request.priorTranscript??[]),...messages.map(m=>({role:m.role as 'user'|'assistant',text:m.text.trim().slice(0,6000)})).filter(m=>m.text)].slice(-200);
  const deliver=async(text:string)=>{
    const sendFresh=async()=>{
      const transcript=transcriptSoFar();
      const continuedFrom=[...(request.continuedFrom??[]),...(request.sessionId?[request.sessionId]:[])].slice(-20);
      onUpdate(request.id,{priorTranscript:transcript,continuedFrom});
      retired.current=false;setRetiredNotice(false);live.current.reset();
      const recap=transcript.slice(-30).map(t=>`${t.role==='user'?'Human':'Preston'}: ${t.text}`).join('\n\n').slice(-24000);
      await live.current.send(text,{clientContext:{...context(),continuation:{note:'This is the same conversation, continued in a fresh session after the previous runtime ended. Pick up where it left off toward the opening goal; do not redo completed work. Saved policies, builds, uploads and research tasks remain available through your tools.',openingGoal:request.prompt,earlierSessions:continuedFrom,recentTranscript:recap}}});
    };
    if(retired.current){await sendFresh();return;}
    try{await live.current.send(text,{clientContext:context()});}
    catch(err){if(isInactiveSession(err)){await sendFresh();return;}throw err;}
  };
  const send=async(text:string,initial=false,authorizeResearch=true)=>{
    if(sendLock.current||!text.trim()||(unavailable&&!initial))return;
    followLatest.current=true;setReadingHistory(false);
    const generation=++sendGeneration.current;control.reset();
    sendLock.current=true;setSending(true);setError('');setRequestedAt(Date.now());lastPrompt.current=text.trim();
    token.current=crypto.randomUUID();onUpdate(request.id,{token:token.current});
    try{
      if(policyExecution&&request.mode==='research'&&authorizeResearch){
        const response=await fetch('/api/research/terminal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:terminalGrant.current,sessionId:request.sessionId}),signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw Error((await response.json()).error??'Could not authorize this research session.');
        onUpdate(request.id,{terminalGrantId:terminalGrant.current});
      }
      const replayTabs=policyExecution?replayFromPrompt(text).slice(0,12):[];
      if(replayTabs.length)acceptPanels(replayTabs,replayTabs[0].id);
      // Clear as soon as the message is handed off; the reply streams separately.
      const submitted=draft;if(!initial)setDraft('');
      try{await deliver(text.trim());}catch(sendError){if(!initial&&generation===sendGeneration.current)setDraft(submitted);throw sendError;}
    }catch(err){if(generation===sendGeneration.current)setError(err instanceof Error?err.message:'Could not send this request.');}
    finally{if(generation===sendGeneration.current){sendLock.current=false;setSending(false);}}
  };
  const respond=async(response:{requestId:string;optionId?:string;text?:string})=>{
    if(sendLock.current||unavailable)return;
    const generation=++sendGeneration.current;control.reset();
    sendLock.current=true;setSending(true);setError('');setRequestedAt(Date.now());
    const submitted=draft;setDraft('');
    try{await agent.respond([response],{clientContext:context()});}
    catch(err){if(generation===sendGeneration.current){setDraft(submitted);setError(err instanceof Error?err.message:'Could not send your answer.');}}
    finally{if(generation===sendGeneration.current){sendLock.current=false;setSending(false);}}
  };
  const sendRef=useRef(send);sendRef.current=send;
  useEffect(()=>{if(!visible||started.current||(!request.policyId&&policyContext.loading)||settings.modelSettingsSaving||!settings.modelSettingsReady)return;const timer=setTimeout(()=>{started.current=true;void sendRef.current(request.prompt,true);},0);return()=>clearTimeout(timer);},[visible,request.prompt,request.policyId,policyContext.loading,settings.modelSettingsSaving,settings.modelSettingsReady]);
  useEffect(()=>{
    if(recording)return;
    let changed=false;
    for(const message of agent.data.messages)for(const part of message.parts){
      if(part.type!=='dynamic-tool'||part.state!=='output-available'||part.partial||seen.current.has(part.toolCallId))continue;
      seen.current.add(part.toolCallId);changed=true;const output=object(part.output);
      if(['create_view','present_view'].includes(part.toolName)){
        const parsed=presentationInputSchema.safeParse(output?.presentation);
        if(parsed.success&&parsed.data.requestToken===token.current){const {requestToken:_,...next}=parsed.data;acceptPanels([viewPanel(next)]);onUpdate(request.id,{view:next});}
      }
      if(part.toolName==='compose_workspace'){
        const parsed=sessionWorkspaceSchema.safeParse(output?.workspace);
        if(parsed.success&&parsed.data.requestToken===token.current)acceptPanels(parsed.data.tabs,parsed.data.activeTabId,parsed.data.title);
      }
      if(['start_task','research_campaign','autoresearch'].includes(part.toolName)){
        const id=output?.taskId??object(output?.task)?.id??(part.toolName==='start_task'?output?.id:undefined);
        if(typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id)){setTaskId(id);acceptPanels([{id:`research:${id}`,kind:'research',title:'Research',taskId:id}]);}
        if(output?.queued===true)setQueued(true);
      }
    }
    if(changed)onUpdate(request.id,{appliedToolCallIds:[...seen.current]});
  },[agent.data.messages,onUpdate,request.id,recording]);
  useEffect(()=>{
    if(!request.sessionId||recording)return;
    const attached=feed.tasks.filter(task=>task.origin_session_id===request.sessionId&&task.context?.leagueId===leagueId&&researchResultReady(task)&&!tabState.current.tabs.some(panel=>panel.kind==='research'&&panel.taskId===task.id));
    if(attached.length)acceptPanels(attached.map(task=>({id:`research:${task.id}`,kind:'research',title:task.context?.title?.slice(0,120)||'Research',taskId:task.id})));
  },[feed.tasks,request.sessionId,leagueId,recording]);
  useEffect(()=>{if(followLatest.current)end.current?.scrollIntoView({block:'nearest'});},[agent.data.messages,busy]);
  useEffect(()=>{if(!visible)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';workspace.current?.focus();return()=>{document.body.style.overflow=previous;requestAnimationFrame(()=>document.getElementById('workspace-prompt')?.focus());};},[visible]);
  const gatewayCreditsBlocked=/AI Gateway.*(?:credit|fund)|positive credit balance/i.test(error);
  const messages=agent.data.messages.filter(m=>m.role==='user'||m.role==='assistant').map(m=>({id:m.id,role:m.role,parts:m.parts,metadata:m.metadata,text:stripAgentBlocks(m.parts.filter(p=>p.type==='text').map(p=>p.text).join(''))})).filter(m=>m.text.trim()||m.parts.some(p=>p.type==='dynamic-tool'||p.type==='reasoning'));
  const answer=messages.filter(m=>m.role==='assistant'&&m.text.trim()).at(-1)?.text;
  const input=agent.data.messages.flatMap(m=>m.parts).find(p=>p.type==='dynamic-tool'&&p.state==='approval-requested');
  const question=input?.type==='dynamic-tool'?input.toolMetadata?.eve?.inputRequest:undefined;
  const researchId=activePanel?.kind==='research'?activePanel.taskId:taskId;
  const task=researchTasks.find(t=>t.id===researchId)??researchTasks.find(t=>!researchResultReady(t)&&tabs.some(p=>p.kind==='research'&&p.taskId===t.id));
  const prose=(text:string)=><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{a:({children,...props})=><a {...props} target="_blank" rel="noreferrer">{children}</a>}}>{text}</Markdown>;
  return <section ref={workspace} tabIndex={-1} className={`request-workspace${expanded?' canvas-expanded':''}`} hidden={!visible} aria-label="Request workspace">
    <nav className="request-mobile-tabs" aria-label="Request panels"><button aria-pressed={mobilePane==='conversation'} onClick={()=>setMobilePane('conversation')}>Conversation</button><button aria-pressed={mobilePane==='result'} onClick={()=>setMobilePane('result')}>Result{busy?' · Working':''}</button></nav>
    <div className="request-layout">
      <aside className={`request-conversation${mobilePane==='conversation'?' mobile-active':''}`} aria-label="Request conversation">
        <ConversationLink request={request} leagueId={leagueId}/>
        <div className="request-messages" aria-live="polite" onScroll={event=>{const el=event.currentTarget;const nearBottom=el.scrollHeight-el.scrollTop-el.clientHeight<60;followLatest.current=nearBottom;setReadingHistory(!nearBottom);}} onClickCapture={event=>{const summary=(event.target as Element).closest('summary');const toggle=(event.target as Element).closest('[data-activity-toggle]');if(summary&&!summary.parentElement?.hasAttribute('open')||toggle?.getAttribute('aria-expanded')==='false'){followLatest.current=false;setReadingHistory(true);}}}>
          {request.priorTranscript?.length?<>{request.priorTranscript.map((m,index)=><div key={`prior-${index}`} className={`request-message ${m.role}`}>{m.role==='assistant'?prose(m.text):m.text}</div>)}<p className="request-continued">Continued in a new session</p></>:null}
          {!messages.length?(request.priorTranscript?.length?null:<div className="request-message user">{request.prompt}</div>):messages.map((m,index)=><div key={m.id}>
            {m.role==='assistant'?<SessionActivity parts={m.parts} active={busy&&index===messages.length-1&&m.metadata?.status!=='complete'&&m.metadata?.status!=='failed'}/>:null}
            {m.text?<div className={`request-message ${m.role}`}>{m.role==='assistant'?prose(m.text):m.text}</div>:null}
          </div>)}
          {busy||control.terminal||control.idle||progressState.phase==='connecting'?<SessionLiveStatus {...runtimeFeedback} requestedAt={requestedAt} events={agent.events} transport={sending&&agent.status==='ready'?'submitted':agent.status} starting={!started.current} compact={activePanel?.kind==='terminal'} onReconnect={()=>void reconnect()}/>:null}
          {goal.error&&(settings.researchMode==='extreme'||goal.goal)?<p className="request-error" role="alert">{goal.error} <button type="button" disabled={goal.busy} onClick={goal.refresh}>Check status</button></p>:null}
          {goal.notice?<p className="request-error" role="status">{goal.notice}</p>:null}
          {control.error?<p className="request-error" role="alert">{control.error} <button type="button" onClick={()=>void control.check()}>Check status</button></p>:null}
          {control.terminal&&control.runtimeState!=='failed'?<p className="request-continued">Your conversation is saved. Send a follow-up to continue.</p>:null}
          {retiredNotice&&!busy?<div className="request-error" role="status"><strong>Preston stopped on an error</strong><p>Your conversation is saved. Send a message, or continue, and Preston picks up where it left off.</p><button disabled={unavailable} onClick={()=>void send('Continue where you left off.')}>Continue</button></div>:null}
          {error&&!retiredNotice&&!isInactiveSession({message:error})?<div className="request-error" role="alert"><strong>Preston couldn’t finish</strong><p>{error}</p>{gatewayCreditsBlocked?<a href="https://vercel.com/d?to=%2F%5Bteam%5D%2F~%2Fai%3Fmodal%3Dtop-up" target="_blank" rel="noreferrer">Add Gateway credits ↗</a>:null}<button disabled={unavailable} onClick={()=>void send(lastPrompt.current)}>Try again</button></div>:null}
          {question?<div className="request-question"><strong>Your input</strong><p>{question.prompt}</p><details><summary>Action details</summary><pre>{JSON.stringify(input?.type==='dynamic-tool'?input.input:null,null,2)}</pre></details>{question.options?.map(option=><button key={option.id} disabled={unavailable} onClick={()=>{void respond({requestId:question.requestId,optionId:option.id});}}>{option.label}</button>)}</div>:null}
          {(queued&&!task||task&&!researchResultReady(task))?<div className="request-background-note">{task?`Research ${task.status.replaceAll('_',' ')}.`:'Research queued.'} Findings will appear when ready. <button onClick={()=>onLab(task?.id)}>Inspect in Lab ↗</button></div>:null}
          {accountId&&request.sessionId?<VoiceHistory accountId={accountId} leagueId={leagueId} chatSessionId={request.sessionId}/>:null}
          <div ref={end}/>
        </div>
        {readingHistory?<button type="button" className={activityStyles.jump} onClick={()=>{followLatest.current=true;setReadingHistory(false);end.current?.scrollIntoView({block:'nearest'});}}>Jump to latest ↓</button>:null}
        <form className="request-followup" onSubmit={event=>{event.preventDefault();if(unavailable||!draft.trim())return;if(question&&((question.allowFreeform||question.display==='text'))){void respond({requestId:question.requestId,text:draft.trim()});}else if(!question)void send(draft);}}>
          <Textarea aria-label="Follow up with Preston" placeholder={question?'Your answer…':'Ask a follow-up…'} value={draft} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();if(!unavailable&&draft.trim())event.currentTarget.form?.requestSubmit();}}} rows={3} className="border-0 bg-transparent shadow-none focus-visible:ring-0"/>
          <div className={composerStyles.toolbar}><div className={composerStyles.options}><SelectField contentClassName={composerStyles.modelMenu} aria-label="Conversation agent" value={request.agentMode??"preston"} disabled={unavailable} onValueChange={value=>{if(value==="preston"||value==="hermes"){onUpdate(request.id,{agentMode:value});setAgentDefault(value);}}} options={[...agentModeOptions]} className={composerStyles.model}/><SelectField contentClassName={composerStyles.modelMenu} aria-label="Request model" value={settings.chatModel} disabled={unavailable} onValueChange={value=>{if(isChatModel(value))settings.onChatModel(value);}} options={chatModels.map(value=>({value,label:modelLabels[value]}))} className={composerStyles.model}/><SelectField className={composerStyles.model} contentClassName={composerStyles.modelMenu} aria-label="Tool permissions" value={settings.permissionMode} disabled={unavailable} onValueChange={value=>{if(value==="ask"||value==="auto")settings.onPermissionMode(value);}} options={[...permissionOptions]}/><SelectField className={composerStyles.model} contentClassName={composerStyles.modelMenu} aria-label="Research mode" value={settings.researchMode} disabled={unavailable} onValueChange={value=>{if(value==="standard"||value==="extreme")settings.onResearchMode(value);}} options={[...researchModeOptions]}/></div><ComposerRunButton running={busy||goalRunning} resumable={!draft.trim()&&settings.researchMode==='extreme'&&!!goal.state&&['paused','stopped','needs_input'].includes(goal.state)} pending={control.stopping||goal.busy} sendDisabled={unavailable||!draft.trim()||!!question&&!((question.allowFreeform||question.display==='text'))} resumeDisabled={unavailable||!goal.canResume} onStop={()=>void stopResponse()} onResume={()=>void resumeResearch()}/></div>
          {settings.error?<p role="alert">{settings.error}<button type="button" onClick={settings.retrySettings}>Retry settings</button></p>:null}
          {savedError?<p role="status">History couldn’t sync. <button type="button" onClick={()=>{setSaveAttempt(n=>n+1);}}>Retry saving</button></p>:null}
        </form>
      </aside>
      <section className={`request-canvas${mobilePane==='result'?' mobile-active':''}`} aria-label="Request result">
        <div className="request-canvas-toolbar">
          <SessionTabs leagueId={leagueId} onCreate={panel=>{if(!recording)acceptPanels([panel],panel.id);}} tabs={visibleTabs} closed={hiddenTabs} activeId={activePanel?.id} disabled={recording} onSelect={selectPanel} onClose={closePanels} onReopen={reopenPanel}/>
          <div className="request-canvas-actions">{research.remaining>0?<button type="button" className="text-button" disabled={recording||research.loading} onClick={research.loadMore} aria-label="Load more saved findings">More results ({research.remaining})</button>:null}{busy?<LoaderCircle size={14} className="animate-spin" aria-label="Working"/>:null}{activePanel||tabs.some(p=>p.kind==='research')?<button disabled={recording} aria-label="Refresh result" onClick={()=>setRefresh(n=>n+1)}><RotateCcw size={15}/></button>:null}<button aria-label={expanded?'Show conversation':'Expand result'} onClick={()=>setExpanded(value=>!value)}>{expanded?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button></div>
        </div>
        <div className={`request-canvas-body ${panelSurface.surface} ${typography.typography}`} id="session-tab-panel" role={activePanel?"tabpanel":undefined} aria-labelledby={activePanel?`session-tab-${visibleTabs.indexOf(activePanel)}`:undefined}>
          {research.unavailable>0?<p role="status">Some saved findings could not be loaded. <button type="button" className="text-button" disabled={recording||research.loading} onClick={()=>setRefresh(n=>n+1)}>Retry saved findings</button></p>:null}
          {!activePanel&&closedTabs.length?<div className="request-tabs-empty"><p>All tabs are closed.</p><button onClick={()=>{const last=hiddenTabs.at(-1);if(last)reopenPanel(last.id);}} disabled={!hiddenTabs.length}>Reopen last tab</button></div>:activePanel?.kind==='game-guide'?<GameGuide key={`${leagueId}:${activePanel.id}:${activePanel.manifestHash??''}:${activePanel.documentId??''}:${refresh}`} leagueId={leagueId} manifestHash={activePanel.manifestHash} documentId={activePanel.documentId}/>:activePanel?.kind==='terminal'?<SessionTerminal sessionId={request.sessionId} panel={activePanel.panel} parts={agent.data.messages.flatMap(m=>m.parts)} busy={busy} activity={<SessionLiveStatus {...runtimeFeedback} requestedAt={requestedAt} events={agent.events} transport={sending&&agent.status==='ready'?'submitted':agent.status} starting={!started.current} onReconnect={()=>void reconnect()}/>} onStop={()=>void stopResponse()}/>:activePanel?.kind==='app'?<SessionApp key={activePanel.id} onOpenTab={reopenPanel} tabIds={availableTabs.map(tab=>tab.id)} locked={recording} templateId={activePanel.templateId??(activePanel.id==='app-home'?request.template?.id:undefined)} replayContent={<ReplayLibrary key={`${leagueId}:${policyId}:${refresh}`} policyId={policyId} leagueId={leagueId} selectedId={String(request.appValues?.[activePanel.id]?.["selected-episode"]??"")} onSelect={id=>onUpdate(request.id,{appValues:{...request.appValues,[activePanel.id]:{...request.appValues?.[activePanel.id],["selected-episode"]:id}}})} moments={request.replayMoments} onMoments={(id,moments)=>onUpdate(request.id,{replayMoments:{...request.replayMoments,[id]:moments}})} notes={request.notes??{}} onNote={(id,note)=>onUpdate(request.id,{notes:{...request.notes,[id]:note}})} onRecordingChange={active=>{setRecording(active);onRecordingChange?.(active);}}/>} panel={activePanel} values={request.appValues?.[activePanel.id]??{}} leagueId={leagueId} onChange={(field,value)=>onUpdate(request.id,{appValues:{...request.appValues,[activePanel.id]:{...request.appValues?.[activePanel.id],[field]:value}}})}/>:activePanel?.kind==='policy'?<SessionPolicy key={`${activePanel.id}:${refresh}`} context={policyContext} leagueId={leagueId} leagueName={leagueName} prompt={request.prompt} locked={recording} replays={<ReplayLibrary key={`${leagueId}:${policyId}:${refresh}`} policyId={policyId} leagueId={leagueId} selectedId={String(request.appValues?.["policy-context"]?.["selected-episode"]??"")} onSelect={id=>onUpdate(request.id,{appValues:{...request.appValues,["policy-context"]:{...request.appValues?.["policy-context"],["selected-episode"]:id}}})} moments={request.replayMoments} onMoments={(id,moments)=>onUpdate(request.id,{replayMoments:{...request.replayMoments,[id]:moments}})} notes={request.notes??{}} onNote={(id,note)=>onUpdate(request.id,{notes:{...request.notes,[id]:note}})} onRecordingChange={active=>{setRecording(active);onRecordingChange?.(active);}}/>} findings={visibleTabs.filter(p=>p.kind!=="policy")} onOpen={selectPanel}/>:activePanel?.kind==='replay'&&!policyExecution?<LeagueReplay key={`${leagueId}:${activePanel.id}:${refresh}`} leagueId={leagueId} episodeId={activePanel.episodeId} title={activePanel.title} notes={{values:request.notes??{},onChange:(key,value)=>onUpdate(request.id,{notes:{...request.notes,[key]:value}})}}/>:activePanel?.kind==='replay'?<SessionReplay key={`${activePanel.id}:${refresh}`} panel={activePanel} coaching preferredPolicyId={policyId} moments={request.replayMoments?.[activePanel.episodeId]??[]} onMoments={moments=>onUpdate(request.id,{replayMoments:{...request.replayMoments,[activePanel.episodeId]:moments}})} onRecordingChange={active=>{setRecording(active);onRecordingChange?.(active);}} note={request.notes?.[activePanel.id]??''} onNote={note=>onUpdate(request.id,{notes:{...request.notes,[activePanel.id]:note}})}/>:activePanel?.kind==='research'&&task?<SessionResearch key={`${activePanel.id}:${refresh}`} task={task} title={activePanel.title} onLab={onLab}/>:view?<SessionEvidence key={`${activePanel?.id}:${refresh}`} view={view} leagueId={leagueId}/>:answer?<article className={`request-answer${task||queued?' with-research':''}`}>{prose(answer)}</article>:<div className="request-empty"><div className="request-empty-icon">{busy?<LoaderCircle size={30} className="animate-spin"/>:<Sparkles size={30}/>}</div><h1>{error?'Let’s get this moving':busy?'Preston is working on your request.':'Your workspace is ready.'}</h1><p>{error?'Preston hit a blocker. Your request is saved; retry when it’s resolved.':busy?'Preston’s findings and interactive views will appear here.':'Ask a follow-up or direct Preston toward the next step.'}</p>{error?<button className="human-primary" disabled={unavailable} onClick={()=>void send(lastPrompt.current)}>Try again</button>:null}</div>}

          {question?<button className="request-input-needed" onClick={()=>{setExpanded(false);setMobilePane('conversation');}}>Preston needs your input <ChevronRight size={16}/></button>:null}
        </div>
      </section>
    </div>
  </section>;
}
