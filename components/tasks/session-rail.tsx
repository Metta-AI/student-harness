"use client";
import {useEffect,useState} from 'react';
import type {Task} from '../../lib/tasks/model';
import {taskStatuses, type TaskFeed,type CampaignSummary} from './use-task-feed';
import {taskActivity} from '../../lib/tasks/activity';
const ended=(status:string)=>['completed','failed','canceled'].includes(status);
function SessionRow({task,selected,onSelect}:{task:Task;selected:string|null;onSelect:(id:string)=>void}){
 const title=task.context?.title??task.objective.split('\n')[0];
 const status=taskActivity(task).label;
 return <a href={`/sessions/${task.id}`} title={title} className={`background-session-row ${selected===task.id?'selected':''}`} aria-current={selected===task.id?'page':undefined} onClick={event=>{if(event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onSelect(task.id);}}}><span><i className={task.status}/>{title}</span><small>{task.status==='needs_input'&&task.checkpoint.daily_budget_day?'Daily budget reached':status}</small></a>;
}
function CampaignGroup({campaign,feed,selected,onSelect}:{campaign:CampaignSummary;feed:TaskFeed;selected:string|null;onSelect:(id:string)=>void}){
 const childSelected=feed.tasks.some(t=>t.id===selected&&t.context?.campaignId===campaign.id);
 const [open,setOpen]=useState(childSelected),[saved,setSaved]=useState<Task[]>([]),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
 useEffect(()=>{if(childSelected)setOpen(true);},[selected,childSelected]);
 useEffect(()=>{if(!open)return;let active=true;const abort=new AbortController();
  const load=async()=>{try{const r=await fetch(`/api/tasks?campaign=${campaign.id}`,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(10000)])});if(!r.ok)throw Error();const body=await r.json();if(active){setSaved(body.tasks);setLoaded(true);setError('');}}catch{if(active)setError('Could not refresh sessions.');}};
  void load();const timer=setInterval(load,10000);return()=>{active=false;abort.abort();clearInterval(timer);};
 },[open,campaign.id]);
 const children=[...new Map([...saved,...feed.tasks.filter(t=>t.context?.campaignId===campaign.id)].map(t=>[t.id,t])).values()].sort((a,b)=>Number(ended(a.status))-Number(ended(b.status))||b.created_at.localeCompare(a.created_at));
 const running=children.filter(t=>!ended(t.status)).length;
 return <div className="campaign-rail-group"><a className={`background-session-row campaign-rail-row ${selected===campaign.task_id?'selected':''}`} href={`/sessions/${campaign.task_id}`} aria-current={selected===campaign.task_id?'page':undefined} title={campaign.objective} onClick={event=>{if(event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onSelect(campaign.task_id);}}}><span><i className={campaign.state==='active'?'running':campaign.state}/>{campaign.objective}</span><small>{campaign.state==='active'?campaign.phase.replaceAll('-',' '):campaign.state} · Cycle {campaign.cycle+1}</small></a>
  <button className="campaign-session-toggle text-button" aria-expanded={open} aria-controls={`campaign-children-${campaign.id}`} onClick={()=>setOpen(v=>!v)}>{open?'▾':'▸'} Sessions{children.length?` · ${children.length}`:''}{running?` · ${running} active`:''}</button>
  {open?<div id={`campaign-children-${campaign.id}`} className="campaign-rail-children">{error?<small>{error}</small>:null}{children.map(task=><SessionRow key={task.id} task={task} selected={selected} onSelect={onSelect}/>)}{!children.length&&!error?<p className="muted">{loaded?'No sessions yet.':'Loading sessions…'}</p>:null}{children.length>=100?<a className="text-button" href={`/sessions/${campaign.task_id}`}>View all in campaign ↗</a>:null}</div>:null}
 </div>;
}
export function SessionRail({feed,selected,onSelect,onNew}:{feed:TaskFeed;selected:string|null;onSelect:(id:string)=>void;onNew:()=>void}){
 const campaigns=feed.campaigns??[],roots=new Set(campaigns.map(c=>c.task_id));
 const standalone=feed.tasks.filter(t=>!roots.has(t.id)&&!t.context?.campaignId&&t.context?.mode!=='campaign');
 const active=standalone.filter(t=>!ended(t.status)),recent=standalone.filter(t=>ended(t.status)).slice(0,8);
 const running=campaigns.filter(c=>!ended(c.state)),past=campaigns.filter(c=>ended(c.state));
 return <section className="background-sessions" aria-label="Campaigns and sessions"><header><h2>Campaigns <small>{running.length}</small></h2><button className="text-button" aria-label="New campaign" onClick={onNew}>+</button></header>
 {feed.error?<p role="status">Could not refresh. <button className="text-button" onClick={()=>void feed.refresh()}>Retry</button></p>:!feed.loaded?<p>Loading…</p>:null}
 {running.map(c=><CampaignGroup key={c.id} campaign={c} feed={feed} selected={selected} onSelect={onSelect}/>)}
 {!running.length&&feed.loaded?<p className="muted">No active campaigns.</p>:null}
 {past.length?<details><summary>Past campaigns · {past.length}</summary>{past.map(c=><CampaignGroup key={c.id} campaign={c} feed={feed} selected={selected} onSelect={onSelect}/>)}</details>:null}
 <div className="standalone-sessions"><header><h2>Standalone sessions <small>{active.length}</small></h2></header>{active.map(task=><SessionRow key={task.id} task={task} selected={selected} onSelect={onSelect}/>)}{recent.length?<details><summary>Recent · {recent.length}</summary>{recent.map(task=><SessionRow key={task.id} task={task} selected={selected} onSelect={onSelect}/>)}</details>:null}</div>
 </section>;
}
