"use client";
import {useEffect,useState} from 'react';
import {Client} from 'eve/client';
import {applyTranscriptEvent,type TranscriptEntry} from '../../lib/tasks/transcript';
import type {Task,TaskWorker} from '../../lib/tasks/model';
export type SessionDetail={task:Task;workers:TaskWorker[];sessionIds:string[];artifacts?:{id:string;title:string;kind:string}[];history:{id:number;kind:string;created_at:string;content:{text?:string;summary?:string;status?:string;reason?:string;nextStep?:string}}[]};
export function useSessionHistory(id:string|null) {
 const [detail,setDetail]=useState<SessionDetail|null>(null),[entries,setEntries]=useState<TranscriptEntry[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  setDetail(null);setEntries([]);setError('');if(!id)return;
  let disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
  const abort=new AbortController(),client=new Client({host:window.location.origin});
  const streams=new Map<string,ReturnType<typeof client.sessions.attach>>(),records=new Map<string,TranscriptEntry>();
  async function poll(){
   try {
    setLoading(true);
    const response=await fetch(`/api/tasks/${id}`,{cache:'no-store',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(15000)])});
    const body=await response.json();if(!response.ok)throw Error(body.error??'Session unavailable');
    if(disposed)return;setDetail(body);
    let incomplete=false;
    for(let i=0;i<body.sessionIds.length;i+=4){
     const outcomes=await Promise.allSettled((body.sessionIds as string[]).slice(i,i+4).map(async sessionId=>{
      let stream=streams.get(sessionId);if(!stream){stream=client.sessions.attach(sessionId);streams.set(sessionId,stream);}
      for await(const event of stream.stream({follow:false,signal:AbortSignal.any([abort.signal,AbortSignal.timeout(12000)]),streamReconnectPolicy:{reconnect:false}})){
       if(disposed)return;applyTranscriptEvent(records,sessionId,event);
      }
     }));
     if(disposed)return;
     incomplete ||= outcomes.some(r=>r.status==='rejected');
     setEntries([...records.values()].sort((a,b)=>a.at.localeCompare(b.at)));
    }
    setError(incomplete?'Some execution logs could not refresh. Saved history is still shown.':'');
   }catch(e){if(!disposed)setError(e instanceof Error&&e.name!=='TimeoutError'?e.message:'Reconnecting to session history…');}
   finally{if(!disposed){setLoading(false);timer=setTimeout(()=>void poll(),5000);}}
  }
  void poll();return()=>{disposed=true;abort.abort();clearTimeout(timer);};
 },[id,retry]);
 return {detail,entries,error,loading,retry:()=>setRetry(n=>n+1)};
}
