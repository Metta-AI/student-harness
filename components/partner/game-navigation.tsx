"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { defaultLeagueId,workspaceURL,type CatalogLeague } from "../../lib/league-catalog";

export function GamePicker({ onSelect, disabled, leagueName, leagueId=defaultLeagueId, gameName="Gods of the Arena" }: { onSelect: () => void; disabled: boolean; leagueName: string; leagueId?:string;gameName?:string }) {
  const [open,setOpen]=useState(false),[leagues,setLeagues]=useState<CatalogLeague[]>([]),[query,setQuery]=useState(""),[error,setError]=useState("");
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener("pointerdown",outside);return()=>document.removeEventListener("pointerdown",outside);},[]);
  useEffect(()=>{if(!open)return;const abort=new AbortController();setError("");void fetch('/api/leagues',{signal:abort.signal}).then(async r=>{if(!r.ok)throw Error();setLeagues((await r.json()).leagues);}).catch(()=>{if(!abort.signal.aborted)setError("Could not load leagues. Reopen to retry.");});return()=>abort.abort();},[open]);
  const filtered=leagues.filter(l=>`${l.game.name} ${l.name}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="game-picker" ref={root} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);root.current?.querySelector('button')?.focus();}}}>
    <button className="game-picker-trigger" type="button" disabled={disabled} aria-label={`Choose game and league: ${gameName}, ${leagueName}`} aria-expanded={open} aria-controls="game-picker-options" onClick={()=>setOpen(v=>!v)}>{gameName==="Gods of the Arena"?<img src="/gota/logo.png" alt=""/>:null}<span>{gameName}{leagueName!==gameName?<small> · {leagueName}</small>:null}</span><ChevronDown size={14}/></button>
    {open?<div id="game-picker-options" className="game-picker-options league-catalog-picker"><label><Search size={14}/><input autoFocus aria-label="Search games and leagues" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find a game or league"/></label><div className="league-catalog-results" aria-label="Games and leagues">{filtered.map(l=><a key={l.id} href={workspaceURL(l.id)} onClick={e=>{if(l.id===leagueId){e.preventDefault();onSelect();setOpen(false);}}} aria-current={l.id===leagueId?'page':undefined}><div><strong>{l.game.name}</strong><small>{l.name}{l.id===defaultLeagueId?' · Default':''}</small></div>{l.id===leagueId?<Check size={14}/>:null}</a>)}</div>{error?<p role="status">{error}</p>:!leagues.length?<p>Loading Softmax games…</p>:!filtered.length?<p>No matching leagues.</p>:null}</div>:null}
  </div>;
}
