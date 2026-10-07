'use client';
import {useState} from 'react';
import {SessionPayload} from './session-payload';
export function AuditEvidence({artifacts}:{artifacts:{id:string;title:string}[]}){
 const [selected,setSelected]=useState<string|null>(null),[output,setOutput]=useState<unknown>(undefined),[error,setError]=useState('');
 async function open(id:string){setSelected(id);setOutput(undefined);setError('');try{const r=await fetch(`/api/research/artifacts?id=${id}`,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Could not load evidence');const a=await r.json();setOutput(a.content);}catch{setError('Evidence could not load. Select it to retry.');}}
 return <section aria-label="Replay audit evidence"><details open><summary>Verified replay outputs · {artifacts.length}</summary><ul className="campaign-sessions campaign-artifact-list">{artifacts.map(a=><li key={a.id}><button className="text-button" onClick={()=>void open(a.id)}>{a.title}</button></li>)}</ul></details>{selected?<details open><summary>{artifacts.find(a=>a.id===selected)?.title}</summary>{error?<p>{error}</p>:output===undefined?<p>Loading evidence…</p>:<SessionPayload output={output}/>}</details>:null}</section>;
}
