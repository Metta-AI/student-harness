"use client";
import {useState} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {Task} from '../../lib/tasks/model';
import type {TranscriptEntry} from '../../lib/tasks/transcript';
import type {SessionDetail} from './use-session-history';
import {readableText, resultPreview} from '../../lib/tasks/communication';
import {SessionPayload,payloadPreview} from './session-payload';

function timestamp(at:string,full=false){const date=new Date(at);return Number.isNaN(date.valueOf())?'':full?date.toLocaleString():date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
function Message({text}:{text:string}){
 const [expanded,setExpanded]=useState(false);
 const long=text.length>700||text.split('\n').length>10;
 return <div className="session-prose"><div className={long&&!expanded?'session-prose-preview':''}><Markdown remarkPlugins={[remarkGfm]} skipHtml>{text}</Markdown></div>{long?<button type="button" className="text-button session-read-more" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'Show less':'Read full message'}</button>:null}</div>;
}
function ReaderMessage({text}:{text:string}) {
 const plain=readableText(text);
 return <><Message text={plain}/>{plain!==text?<details className="session-evidence"><summary>Original technical note</summary><Message text={text}/></details>:null}</>;
}
function ToolEntry({entry,task}:{entry:TranscriptEntry;task:Task}){
 const [open,setOpen]=useState(false);
 const status=entry.state==='running'?(task.status==='running'?'Running':'Interrupted'):entry.state==='failed'?'Failed':entry.state==='done'?'Done':'';
 return <details className="session-tool" onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary><span className={`session-tool-state ${entry.state??''}`} aria-hidden="true"/><strong>{entry.name??(entry.kind==='result'?'Result':'Execution details')}</strong><span className="session-tool-preview">{payloadPreview(entry.input??entry.output)}</span><span className="session-tool-status">{status}</span><time title={timestamp(entry.at,true)}>{timestamp(entry.at)}</time></summary>
  {open?<SessionPayload input={entry.input} output={entry.output}/>:null}
 </details>;
}
export function SessionTranscript({task,entries,history,loading,error,onRetry,outcomeAtTop=false}:{outcomeAtTop?:boolean;task:Task;entries:TranscriptEntry[];history:SessionDetail['history'];loading:boolean;error:string;onRetry:()=>void}){
 const events=[...entries.map(entry=>({id:entry.id,at:entry.at,entry})),...history.map(item=>({id:`history:${item.id}`,at:item.created_at,item}))].sort((a,b)=>a.at.localeCompare(b.at));
 const result=task.result as {summary?:string;evidence?:string[]}|null;
 return <section className="session-transcript" aria-label="Session history">
  <header><h3>History <span>{events.length}</span></h3><span>{loading?'Syncing…':task.status==='running'?'Live':''}</span><button className="text-button" onClick={onRetry}>Refresh history</button></header>
  {error?<p className="muted" role="status">{error}</p>:null}
  <ol>
   <li className="session-message human"><div className="session-event-meta"><strong>You</strong><time>{timestamp(task.created_at,true)}</time></div><Message text={task.objective}/><p className="session-target"><b>Done when:</b> {task.acceptance_criteria}</p></li>
   {events.map(event=>{
    if('item' in event){const item=event.item;return <li key={event.id} className={`session-message ${item.kind==='direction'?'human':'activity'}`}><div className="session-event-meta"><strong>{item.kind==='direction'?'You':item.kind==='progress'?'Progress':item.content.status?.replaceAll('_',' ')}</strong><time title={timestamp(event.at,true)}>{timestamp(event.at)}</time></div>{item.kind==='direction'?<Message text={item.content.text??''}/>:<ReaderMessage text={item.content.text??item.content.summary??item.content.reason??''}/>}</li>;}
    const entry=event.entry;
    if(entry.kind==='tool'||entry.kind==='result')return <li key={entry.id} className="session-tool-row"><ToolEntry entry={entry} task={task}/></li>;
    if(entry.kind==='error')return <li key={entry.id} className="session-incident"><details><summary><strong>Attempt interrupted</strong><span>{entry.text}</span><time title={timestamp(entry.at,true)}>{timestamp(entry.at)}</time></summary><SessionPayload output={entry.output}/></details></li>;
    return <li key={entry.id} className={`session-message ${entry.kind}`}><div className="session-event-meta"><strong>Preston</strong><time title={timestamp(entry.at,true)}>{timestamp(entry.at)}</time></div>
     {entry.text?<ReaderMessage text={entry.text}/>:null}
     {entry.input!==undefined||entry.output!==undefined?<ToolEntry entry={entry} task={task}/>:null}
    </li>;
   })}
   {!events.length?<li className="session-history-empty">{loading?'Loading recorded messages and tool calls…':task.session_id?'No execution log is available yet.':'Queued; execution has not started yet.'}</li>:null}
   {outcomeAtTop?null:result?.summary?<li id={`session-outcome-${task.id}`} className="session-message final"><div className="session-event-meta"><strong>Outcome</strong></div><Message text={resultPreview(result)}/>{result.evidence?.length?<details className="session-evidence"><summary>Evidence · {result.evidence.length}</summary><ul>{result.evidence.map((e,i)=><li key={i}><Markdown remarkPlugins={[remarkGfm]} skipHtml>{e}</Markdown></li>)}</ul></details>:null}</li>:task.reason?<li id={`session-outcome-${task.id}`} className="session-message final"><strong>{task.status==='needs_input'?'Stopped':'Status'}</strong><ReaderMessage text={task.reason}/></li>:null}
  </ol>
 </section>;
}
