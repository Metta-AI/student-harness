"use client";
import { defaultLeagueId } from "../../lib/league-catalog";
import { useEffect,useRef,useState } from 'react';
import { viewDocumentSchema,type ViewDocument } from '../../lib/views/model';
export function GeneratedView({id,leagueId=defaultLeagueId}:{id:string;leagueId?:string}) {
  const [data,setData]=useState<{document:ViewDocument;created_at:string}|null>(null),[error,setError]=useState('');
  useEffect(()=>{const abort=new AbortController();setData(null);setError('');void fetch(`/api/views?id=${encodeURIComponent(id)}&league=${encodeURIComponent(leagueId)}`,{signal:abort.signal}).then(async r=>{if(!r.ok)throw Error('View unavailable');const d=await r.json();const document=viewDocumentSchema.parse(d.document);if(!abort.signal.aborted)setData({...d,document});}).catch(()=>{if(!abort.signal.aborted)setError('This saved view is unavailable.');});return()=>abort.abort();},[id,leagueId]);
  if(!data)return <p role="status">{error||'Loading view…'}</p>;
  return <article className="generated-view"><h2>{data.document.title}</h2><small>Preston’s analysis · {new Date(data.created_at).toLocaleString()}</small>{data.document.summary?<p>{data.document.summary}</p>:null}
    {data.document.blocks.map((block,i)=><section key={i}><h3>{block.title}</h3>
      {block.type==='text'?<p className="generated-text">{block.text}</p>:null}
      {block.type==='table'?<div className="workspace-table-scroll"><table className="workspace-table"><thead><tr>{block.columns.map((c,j)=><th key={j}>{c}</th>)}</tr></thead><tbody>{block.rows.map((r,j)=><tr key={j}>{r.map((cell,k)=><td key={k}>{cell}</td>)}</tr>)}</tbody></table></div>:null}
      {block.type==='steps'?<ol>{block.items.map((item,j)=><li key={j}><strong>{item.label}</strong><p>{item.detail}</p></li>)}</ol>:null}
      {block.type==='bar_chart'?<ul className="generated-bars" aria-label={`${block.title}, ${block.unit}`}>{block.points.map((point,j)=><li key={j}><span>{point.label}</span><span className="generated-bar-track"><i style={{width:`${Math.abs(point.value)/Math.max(1,...block.points.map(p=>Math.abs(p.value)))*100}%`}}/></span><b>{point.value.toLocaleString()} {block.unit}</b></li>)}</ul>:null}
      {block.evidence.length?<div className="generated-evidence">{block.evidence.map((e,j)=><a key={j} href={e.href} target="_blank" rel="noreferrer">{e.label} ↗</a>)}</div>:<small className="muted">No evidence linked</small>}
    </section>)}
  </article>;
}
export function GeneratedViewDialog({id,onClose}:{id:string;onClose:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog ref={ref} className="generated-dialog" aria-label="Preston saved view" onCancel={onClose}><button className="secondary" onClick={onClose}>Close view</button><GeneratedView id={id}/></dialog>;
}
export function ViewLibrary({onOpen,refresh}:{onOpen:(id:string)=>void;refresh?:string}) {
  const [open,setOpen]=useState(false),[views,setViews]=useState<{id:string;title:string}[]>([]),[error,setError]=useState('');
  useEffect(()=>{if(!open)return;const abort=new AbortController();void fetch('/api/views',{signal:abort.signal}).then(async r=>{if(!r.ok)throw Error();const d=await r.json();setViews(d.views);setError('');}).catch(()=>{if(!abort.signal.aborted)setError('Views unavailable.');});return()=>abort.abort();},[open,refresh]);
  return <details className="view-library" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>Saved views</summary>{error?<p>{error}</p>:views.length?views.map(v=><button className="text-button" key={v.id} onClick={()=>onOpen(v.id)}>{v.title} ↗</button>):<p>No saved views yet. Ask Preston to make one.</p>}</details>;
}
