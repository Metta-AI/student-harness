"use client";
import {useEffect,useState} from 'react';
import {defaultLeagueId} from '../../lib/league-catalog';
import {readVoiceConversation} from '../../lib/voice/conversation';

export type SavedChat={session_id:string;title:string|null;updated_at:string};
type VoiceSession={id:string;started_at:string;chat_session_id?:string|null;league_id?:string|null};
export function ConversationHistory({chats,onChat,onVoice,onRename,onArchive}:{chats:SavedChat[];onChat:(id:string)=>void;onVoice:(id:string)=>void;onRename:(id:string,title:string)=>void;onArchive:(id:string)=>void}){
 const [voices,setVoices]=useState<VoiceSession[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[query,setQuery]=useState('');
 useEffect(()=>{const abort=new AbortController();void fetch('/api/voice/transcripts',{signal:abort.signal}).then(async r=>{if(!r.ok)throw Error();setVoices(((await r.json()).sessions??[]).filter((v:VoiceSession)=>!v.league_id||v.league_id===defaultLeagueId));}).catch(()=>{if(!abort.signal.aborted)setError('Voice history could not load. Text conversations are still available.');}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>abort.abort();},[]);
 async function download(id:string){
  try{const events=await readVoiceConversation(id,AbortSignal.timeout(15000));const url=URL.createObjectURL(new Blob([JSON.stringify({session:id,events},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='preston-conversation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  catch{setError('Could not download the transcript. Try again.');}
 }
 const rows=[...chats.map(c=>({id:c.session_id,title:c.title??'Conversation',at:voices.filter(v=>v.chat_session_id===c.session_id).reduce((at,v)=>v.started_at>at?v.started_at:at,c.updated_at),kind:'text' as const})),...voices.filter(v=>!v.chat_session_id).map(v=>({id:v.id,title:'Voice conversation',at:v.started_at,kind:'voice' as const}))].sort((a,b)=>b.at.localeCompare(a.at)).filter(c=>`${c.title} ${c.kind} ${voices.some(v=>v.chat_session_id===c.id)?'voice':''} ${new Date(c.at).toLocaleString()}`.toLowerCase().includes(query.toLowerCase()));
 return <div className="conversation-history"><h3>Conversation history</h3><input autoFocus aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={e=>setQuery(e.target.value)}/>{error?<p role="status">{error}</p>:null}{loading?<p role="status">Loading voice conversations…</p>:null}
  <ul>{rows.map(row=><li key={`${row.kind}:${row.id}`}><button className="conversation-history-entry" onClick={()=>row.kind==='voice'?onVoice(row.id):onChat(row.id)}><strong>{row.title}</strong><span>{row.kind==='voice'?'Voice':voices.some(v=>v.chat_session_id===row.id)?'Voice & text':'Text'} · {new Date(row.at).toLocaleString()}</span></button>{row.kind==='text'?<details><summary aria-label={`Actions for ${row.title}`}>⋯</summary><form onSubmit={e=>{e.preventDefault();const title=new FormData(e.currentTarget).get('title');if(typeof title==='string'&&title.trim())onRename(row.id,title);}}><input name="title" aria-label="Conversation name" defaultValue={row.title} maxLength={80}/><button>Rename</button></form><button onClick={()=>onArchive(row.id)}>Archive</button>{voices.filter(v=>v.chat_session_id===row.id).map((v,i)=><button key={v.id} onClick={()=>void download(v.id)}>Download voice log {i+1}</button>)}</details>:<details><summary aria-label="Voice conversation actions">⋯</summary><button onClick={()=>void download(row.id)}>Download voice log</button></details>}</li>)}</ul>{!loading&&!rows.length?<p>No conversations found.</p>:null}
 </div>;
}
