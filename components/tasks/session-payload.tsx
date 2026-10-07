"use client";
import {useState} from 'react';

export function payloadPreview(value:unknown):string {
 if(typeof value==='string')return value.replace(/\s+/g,' ').slice(0,180);
 if(value && typeof value==='object' && !Array.isArray(value)){
  const record=value as Record<string,unknown>;
  if(typeof record.program==='string'&&Array.isArray(record.args))return payloadPreview([record.program,...record.args].join(' '));
  for(const key of ['command','summary','objective','message','query','path','status'])if(typeof record[key]==='string')return payloadPreview(record[key]);
 }
 return (JSON.stringify(value)??'').replace(/\s+/g,' ').slice(0,180);
}
/** Render large payloads only on demand, in a bounded, independently scrollable pane. */
export function SessionPayload({input,output}:{input?:unknown;output?:unknown}){
 const [tab,setTab]=useState<'input'|'output'>(output!==undefined?'output':'input');
 const [expanded,setExpanded]=useState(false);
 const selected=tab==='output'&&output!==undefined?'output':input!==undefined?'input':'output';
 const value=selected==='input'?input:output;
 const text=typeof value==='string'?value:JSON.stringify(value,null,2)??'';
 return <div className={`session-payload ${expanded?'expanded':''}`}>
  <div className="session-payload-toolbar" role="group" aria-label="Tool payload">
   {input!==undefined?<button type="button" aria-pressed={selected==='input'} onClick={()=>setTab('input')}>Input</button>:null}
   {output!==undefined?<button type="button" aria-pressed={selected==='output'} onClick={()=>setTab('output')}>Output</button>:null}
   <span>{text.length.toLocaleString()} chars</span>
   <button type="button" className="payload-expand" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'Compact':'Expand'}</button>
  </div>
  <pre tabIndex={0} aria-label={`${selected==='input'?'Input':'Output'} content`}>{text}</pre>
 </div>;
}
