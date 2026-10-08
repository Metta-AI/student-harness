"use client";
import {useState} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {humanSummaryOf, resultPreview} from '../../lib/tasks/communication';
import {SessionPayload} from './session-payload';

export function hasSessionOutput(result:unknown):boolean {
 if(result==null)return false;
 if(typeof result==='string')return result.trim().length>0;
 if(typeof result==='object')return Object.keys(result).length>0;
 return true;
}

/** Keep the saved result visible without making a long report dominate the session. */
export function SessionOutcome({taskId,result}:{taskId:string;result:unknown}){
 const [expanded,setExpanded]=useState(false);
 const [outputOpen,setOutputOpen]=useState(false);
 const record=result&&typeof result==='object'&&!Array.isArray(result)?result as Record<string,unknown>:{};
 const report=humanSummaryOf(result);
 const summary=report?.outcome??resultPreview(result);
 const strings=(value:unknown)=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'&&!!item.trim()):[];
 const evidence=strings(record.evidence),unknowns=strings(record.unknowns);
 const sections:[string,string[]][]=[['Evidence',evidence],['Open questions',unknowns]];
 const long=summary.length>350||summary.split('\n').length>5;
 return <section id={`session-outcome-${taskId}`} className="session-outcome" aria-label="Session outcome">
  <header><h2>Outcome</h2><span>Saved result</span></header>
  {summary?<>
   <div className={`session-prose ${long&&!expanded?'session-outcome-preview':''}`}><Markdown remarkPlugins={[remarkGfm]} skipHtml>{summary}</Markdown></div>
   {long?<button type="button" className="text-button session-read-more" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'Show less':'Read full outcome'}</button>:null}
  </>:<p>Output is saved. Open the details below to inspect it.</p>}
  {report?<div className="session-human-summary"><p><strong>Why it matters</strong> {report.whyItMatters}</p><p><strong>Next step</strong> {report.nextStep}</p></div>:null}
  {sections.map(([label,values])=>values.length?<details className="session-evidence" key={label}><summary>{label} · {values.length}</summary><ul>{values.map((item,i)=><li className="session-prose" key={i}><Markdown remarkPlugins={[remarkGfm]} skipHtml>{item}</Markdown></li>)}</ul></details>:null)}
  <details className="session-outcome-output" onToggle={event=>setOutputOpen(event.currentTarget.open)}><summary>Technical handoff & full output</summary>{outputOpen?<SessionPayload output={result}/>:null}</details>
 </section>;
}
