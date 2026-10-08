"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {useEveAgent} from 'eve/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {ArrowLeft,ArrowUp,ChevronRight,FlaskConical,LoaderCircle,Maximize2,Minimize2,Pin,RotateCcw,Square,Sparkles} from 'lucide-react';
import {Textarea} from '@/components/ui/textarea';
import {SelectField} from '@/components/ui/select-field';
import {chatModels,modelLabels,isChatModel} from '../../lib/model-selection';
import {composerContext,composerModes} from '../../lib/workspace/composer';
import {presentationInputSchema,type WorkspaceView} from '../../lib/workspace/presentation';
import {stripAgentBlocks} from '../chat-context';
import {readableText,resultPreview} from '../../lib/tasks/communication';
import {campaignCompanion} from '../../lib/partner/companion-summary';
import {PresentationPane} from './presentation-pane';
import type {ChatSettings} from '../use-chat-settings';
import type {TaskFeed} from '../tasks/use-task-feed';
import type {WorkspaceRequest} from './use-workspace-requests';

const canvasInstructions='This request owns an immersive Workspace with a conversation rail and an interactive result canvas. Keep conversational updates concise. Deliver useful visual evidence with create_view or present_view using the current presentation.requestToken; these render directly in the canvas. Use a relevant existing view when possible. For research, check existing work and return the actual task or campaign receipt. Ask necessary questions in this conversation. No screen sharing is needed. Do not describe hidden workers or claim work succeeded without a tool receipt.';
const progress:Record<string,string>={create_view:'Building your view',present_view:'Opening the evidence',policy_status:'Checking your policy',league_status:'Checking the league',task_status:'Checking existing work',autoresearch:'Directing research',research_campaign:'Checking research',start_task:'Starting the requested work',read_policy:'Reading your policy'};
const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;

export function RequestWorkspace({request,leagueId,leagueName,settings,feed,visible,onUpdate,onClose,onLab}:{request:WorkspaceRequest;leagueId:string;leagueName:string;settings:ChatSettings;feed:TaskFeed;visible:boolean;onUpdate:(id:string,patch:Partial<WorkspaceRequest>)=>void;onClose:()=>void;onLab:(id?:string)=>void}){
  const [draft,setDraft]=useState(''),[error,setError]=useState(''),[activity,setActivity]=useState('Getting started'),[sending,setSending]=useState(false),[mobilePane,setMobilePane]=useState<'result'|'conversation'>('result'),[expanded,setExpanded]=useState(false),[refresh,setRefresh]=useState(0),[savedError,setSavedError]=useState(false);
  const [view,setView]=useState<WorkspaceView|undefined>(request.view);
  const [taskId,setTaskId]=useState<string>();
  const [queued,setQueued]=useState(false);
  const token=useRef(request.token),started=useRef(!!request.sessionId),lastPrompt=useRef(request.prompt),sendLock=useRef(false),seen=useRef(new Set<string>()),end=useRef<HTMLDivElement>(null);
  const initialSession=useRef(request.sessionId);
  const back=useRef<HTMLButtonElement>(null);
  const savedSession=useRef('');
  const saveSession=useCallback(async(sessionId:string)=>{
    onUpdate(request.id,{sessionId});
    try{const response=await fetch('/api/chats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,title:request.prompt.slice(0,80)}),signal:AbortSignal.timeout(12000)});setSavedError(!response.ok);}catch{setSavedError(true);}
  },[onUpdate,request.id,request.prompt]);
  const agent=useEveAgent({
    ...(initialSession.current?{initialSession:{sessionId:initialSession.current,streamIndex:0},resume:true}:{}),
    onSessionChange:session=>{if(session&&savedSession.current!==session.sessionId){savedSession.current=session.sessionId;void saveSession(session.sessionId);}},
    onError:err=>setError(err.message),
    onEvent:event=>{
      if(event.type==='message.received')setError('');
      if(event.type==='actions.requested')setActivity(progress[event.data.actions[0]?.kind==='tool-call'?event.data.actions[0].toolName:'']??'Working through your request');
      if(event.type==='turn.failed'||event.type==='session.failed')setError(event.data.message??'Preston couldn’t finish this request.');
      if(event.type==='turn.cancelled')setActivity('Stopped');
    },
  });
  const live=useRef(agent);live.current=agent;
  const busy=sending||agent.status==='submitted'||agent.status==='streaming';
  const unavailable=busy||agent.status==='resuming'||settings.modelSettingsSaving||!settings.modelSettingsReady;
  const context=()=>({...composerContext(request.mode,request.id,leagueId,request.policyId),surface:'request-workspace',canvasInstructions,presentation:{requestToken:token.current,human:{leagueId,policyId:request.policyId},pinned:false,view:view?.view??null}});
  const send=async(text:string)=>{
    if(sendLock.current||!text.trim()||unavailable)return;
    sendLock.current=true;setSending(true);setError('');setActivity('Reading your request');lastPrompt.current=text.trim();
    token.current=crypto.randomUUID();onUpdate(request.id,{token:token.current});
    try{await live.current.send(text.trim(),{clientContext:context()});setDraft('');}catch(err){setError(err instanceof Error?err.message:'Could not send this request.');}
    finally{sendLock.current=false;setSending(false);}
  };
  const respond=async(response:{requestId:string;optionId?:string;text?:string})=>{
    if(sendLock.current||unavailable)return;
    sendLock.current=true;setSending(true);setError('');setActivity('Continuing with your input');
    try{await agent.respond([response],{clientContext:context()});setDraft('');}
    catch(err){setError(err instanceof Error?err.message:'Could not send your answer.');}
    finally{sendLock.current=false;setSending(false);}
  };
  const sendRef=useRef(send);sendRef.current=send;
  useEffect(()=>{if(!visible||started.current||settings.modelSettingsSaving||!settings.modelSettingsReady)return;const timer=setTimeout(()=>{started.current=true;void sendRef.current(request.prompt);},0);return()=>clearTimeout(timer);},[visible,request.prompt,settings.modelSettingsSaving,settings.modelSettingsReady]);
  useEffect(()=>{
    for(const message of agent.data.messages)for(const part of message.parts){
      if(part.type!=='dynamic-tool'||part.state!=='output-available'||part.partial||seen.current.has(part.toolCallId))continue;
      seen.current.add(part.toolCallId);const output=object(part.output);
      if(['create_view','present_view'].includes(part.toolName)){
        const parsed=presentationInputSchema.safeParse(output?.presentation);
        if(parsed.success&&parsed.data.requestToken===token.current){const {requestToken:_,...next}=parsed.data;setView(next);onUpdate(request.id,{view:next});setMobilePane('result');}
      }
      if(['start_task','research_campaign','autoresearch'].includes(part.toolName)){
        const id=output?.taskId??object(output?.task)?.id??(part.toolName==='start_task'?output?.id:undefined);
        if(typeof id==='string')setTaskId(id);
        if(output?.queued===true)setQueued(true);
      }
    }
  },[agent.data.messages,onUpdate,request.id]);
  useEffect(()=>{end.current?.scrollIntoView({block:'nearest'});},[agent.data.messages,busy]);
  useEffect(()=>{if(!visible)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';back.current?.focus();return()=>{document.body.style.overflow=previous;requestAnimationFrame(()=>document.getElementById('workspace-prompt')?.focus());};},[visible]);
  const messages=agent.data.messages.filter(m=>m.role==='user'||m.role==='assistant').map(m=>({id:m.id,role:m.role,text:stripAgentBlocks(m.parts.filter(p=>p.type==='text').map(p=>p.text).join(''))})).filter(m=>m.text.trim());
  const answer=messages.filter(m=>m.role==='assistant').at(-1)?.text;
  const input=agent.data.messages.flatMap(m=>m.parts).find(p=>p.type==='dynamic-tool'&&p.state==='approval-requested');
  const question=input?.type==='dynamic-tool'?input.toolMetadata?.eve?.inputRequest:undefined;
  const task=feed.tasks.find(t=>t.id===taskId);
  const campaign=feed.campaigns.find(c=>!['completed','canceled','failed'].includes(c.state))??feed.campaigns[0];
  const finding=campaignCompanion(campaign,feed.tasks,!!feed.error);
  const openView=(next:WorkspaceView)=>{if(next.view==='lab'){onLab(taskId);return;}setView(next);onUpdate(request.id,{view:next});};
  const prose=(text:string)=><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{a:({children,...props})=><a {...props} target="_blank" rel="noreferrer">{children}</a>}}>{text}</Markdown>;
  return <section className={`request-workspace${expanded?' canvas-expanded':''}`} hidden={!visible} aria-label="Request workspace">
    <header className="request-topbar"><button ref={back} className="request-back" onClick={onClose}><ArrowLeft size={17}/>Workspace</button><span className="request-divider"/><div className="request-title"><strong title={request.prompt}>{request.prompt}</strong><small>{leagueName} · {composerModes.find(m=>m.value===request.mode)?.label}</small></div><button className="request-pin" aria-label={request.pinned?'Unpin request':'Pin request'} aria-pressed={request.pinned} onClick={()=>onUpdate(request.id,{pinned:!request.pinned})}><Pin size={16}/><span>{request.pinned?'Pinned':'Pin'}</span></button></header>
    <nav className="request-mobile-tabs" aria-label="Request panels"><button aria-pressed={mobilePane==='conversation'} onClick={()=>setMobilePane('conversation')}>Conversation</button><button aria-pressed={mobilePane==='result'} onClick={()=>setMobilePane('result')}>Result{busy?' · Working':''}</button></nav>
    <div className="request-layout">
      <aside className={`request-conversation${mobilePane==='conversation'?' mobile-active':''}`} aria-label="Request conversation">
        <div className="request-preston"><img src="/preston/preston-kindred-wisp.webp" alt=""/><div><strong>Preston</strong><span>{busy?activity:question?'Your input is needed':error?'Needs attention':'Working with you'}</span></div></div>
        {campaign?<section className="request-exploring"><strong>{finding.finding?'What I’m finding':'What we’re exploring'}</strong><p>{finding.finding??finding.title}</p><button onClick={()=>onLab(finding.sourceId??campaign.task_id)}>Inspect in Lab <ChevronRight size={13}/></button></section>:null}
        <div className="request-messages" aria-live="polite">
          {!messages.length?<div className="request-message user">{request.prompt}</div>:messages.map(m=><div key={m.id} className={`request-message ${m.role}`}>{m.role==='assistant'?<><strong>Preston</strong>{prose(m.text.length>900?m.text.slice(0,900)+'…':m.text)}{m.text.length>900?<button onClick={()=>{setView(undefined);setMobilePane('result');}}>Read full response</button>:null}</>:m.text}</div>)}
          {busy?<div className="request-working" role="status"><LoaderCircle size={15} className="animate-spin"/>{activity}…</div>:null}
          {error?<div className="request-error" role="alert"><strong>Preston couldn’t finish</strong><p>{error}</p><button disabled={unavailable} onClick={()=>void send(lastPrompt.current)}>Try again</button></div>:null}
          {question?<div className="request-question"><strong>Your input</strong><p>{question.prompt}</p><details><summary>Action details</summary><pre>{JSON.stringify(input?.type==='dynamic-tool'?input.input:null,null,2)}</pre></details>{question.options?.map(option=><button key={option.id} disabled={unavailable} onClick={()=>{void respond({requestId:question.requestId,optionId:option.id});}}>{option.label}</button>)}</div>:null}
          <div ref={end}/>
        </div>
        <form className="request-followup" onSubmit={event=>{event.preventDefault();if(unavailable||!draft.trim())return;if(question&&((question.allowFreeform||question.display==='text'))){void respond({requestId:question.requestId,text:draft.trim()});}else if(!question)void send(draft);}}>
          <Textarea aria-label="Follow up with Preston" placeholder={question?'Your answer…':'Refine, ask, or redirect…'} value={draft} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();if(!unavailable&&draft.trim())event.currentTarget.form?.requestSubmit();}}} rows={2} className="border-0 bg-transparent shadow-none focus-visible:ring-0"/>
          <div><SelectField aria-label="Request model" value={settings.chatModel} disabled={unavailable} onValueChange={value=>{if(isChatModel(value))settings.onChatModel(value);}} options={chatModels.map(value=>({value,label:modelLabels[value]}))} className="max-w-40 border-0 bg-transparent text-xs shadow-none"/>{busy?<button type="button" className="request-send" aria-label="Stop response" onClick={()=>void agent.cancel().catch(err=>setError(err.message))}><Square size={15}/></button>:<button className="request-send" type="submit" aria-label="Send follow-up" disabled={unavailable||!draft.trim()||!!question&&!((question.allowFreeform||question.display==='text'))}><ArrowUp size={18}/></button>}</div>
          {settings.error?<p role="alert">{settings.error}<button type="button" onClick={settings.retrySettings}>Retry settings</button></p>:null}
          {savedError?<p role="status">History couldn’t sync. <button type="button" onClick={()=>{if(agent.session)void saveSession(agent.session.sessionId);}}>Retry saving</button></p>:null}
        </form>
      </aside>
      <section className={`request-canvas${mobilePane==='result'?' mobile-active':''}`} aria-label="Request result">
        <div className="request-canvas-toolbar"><span><span className={`request-dot${busy?' working':''}`}/>{busy?'In progress':error?'Needs attention':view||answer?'Ready':'Your result'}</span><div>{view?<button aria-label="Refresh result" onClick={()=>setRefresh(n=>n+1)}><RotateCcw size={15}/></button>:null}<button aria-label={expanded?'Show conversation':'Expand result'} onClick={()=>setExpanded(value=>!value)}>{expanded?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button></div></div>
        <div className="request-canvas-body">
          {view?<PresentationPane key={refresh} view={view} onOpen={openView} embedded leagueId={leagueId} onAsk={prompt=>{setDraft(prompt);setExpanded(false);setMobilePane('conversation');requestAnimationFrame(()=>document.querySelector<HTMLTextAreaElement>('.request-followup textarea')?.focus());}}/>:answer?<article className={`request-answer${task||queued?' with-research':''}`}><div className="request-result-label"><Sparkles size={17}/>Preston’s response</div>{prose(answer)}</article>:<div className="request-empty"><div className="request-empty-icon">{busy?<LoaderCircle size={30} className="animate-spin"/>:<Sparkles size={30}/>}</div><h1>{error?'Let’s get this moving':busy?'Preston is working on your request.':'Your workspace is ready.'}</h1><p>{error?'Preston hit a blocker. Your request is saved; retry when it’s resolved.':busy?'Preston’s findings and interactive views will appear here.':'Ask a follow-up or direct Preston toward the next step.'}</p>{error?<button className="human-primary" disabled={unavailable} onClick={()=>void send(lastPrompt.current)}>Try again</button>:null}</div>}
          {task||queued?<section className="request-research"><FlaskConical size={21}/><div><h3>{task?readableText(task.objective):'Research queued'}</h3><p>{task?task.reason?readableText(task.reason):resultPreview(task.result)||`Status: ${task.status.replaceAll('_',' ')}`:'The request is queued within your workspace limits. Paused work stays paused.'}</p><button onClick={()=>onLab(taskId)}>Inspect in Lab <ChevronRight size={14}/></button></div></section>:null}
          {question?<button className="request-input-needed" onClick={()=>{setExpanded(false);setMobilePane('conversation');}}>Preston needs your input <ChevronRight size={16}/></button>:null}
        </div>
      </section>
    </div>
  </section>;
}
