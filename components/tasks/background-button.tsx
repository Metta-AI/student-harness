"use client";
import {useRef,useState} from 'react';
import type {TaskInput} from '../../lib/tasks/model';
export function BackgroundButton({label,input,onOpen}:{label:string;input:Omit<TaskInput,'requestKey'>;onOpen?:(id:string)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[started,setStarted]=useState<string|null>(null);
 const key=useRef<string|null>(null);
 async function start(){if(busy)return;setBusy(true);setError('');key.current??=crypto.randomUUID();try{
  const response=await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,requestKey:key.current})});const body=await response.json();if(!response.ok)throw Error(body.error??'Could not start session');
  key.current=null;setStarted(body.task.id);window.dispatchEvent(new Event('background-work-updated'));
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <span className="background-trigger"><button className="secondary" disabled={busy} onClick={()=>void start()}>{busy?'Starting…':label}</button>{started?<button className="text-button" disabled={!onOpen} onClick={()=>onOpen?.(started)}>Inspect in Lab ↗</button>:null}{error?<span role="status">{error}</span>:null}</span>;
}
