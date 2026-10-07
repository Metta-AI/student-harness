"use client";
import {useState} from 'react';
import type {OpponentNotebook} from '../../lib/opponents/model';

export function OpponentModel({models,snapshots}:Pick<OpponentNotebook,'models'|'snapshots'>){
 const [selected,setSelected]=useState('');
 const version=models.find(m=>m.id===selected)??models[0];
 if(!version)return <section className="opponent-model"><h3>Semantic model</h3><p className="muted">No model yet. Build one from collected evidence with Preston.</p></section>;
 const model=version.document;
 return <section className="opponent-model" aria-label="Opponent semantic model">
  <div className="workspace-section-heading"><h3>Semantic model</h3><select aria-label="Semantic model version" value={version.id} onChange={e=>setSelected(e.target.value)}>{models.map(m=><option key={m.id} value={m.id}>{new Date(m.created_at).toLocaleString()}</option>)}</select></div>
  <p>{model.summary}</p><p className="evidence-caption">Observational model · {model.nodes.length} concepts · {model.edges.length} connections</p>
  <div className="opponent-model-nodes">{model.nodes.map(node=><article key={node.id}>
   <small>{node.kind} · {node.status}</small><h4>{node.label}</h4><p>{node.claim}</p>
   {model.edges.filter(e=>e.from===node.id).map((edge,i)=><p className="opponent-model-edge" key={i}>{edge.relation.replaceAll('_',' ')} → {model.nodes.find(n=>n.id===edge.to)?.label}</p>)}
   {node.falsifier?<p><b>Would disprove:</b> {node.falsifier}</p>:null}
   <details><summary>Evidence · {node.evidence.length}</summary>{node.evidence.map(id=>{const e=model.evidence.find(e=>e.id===id)!;const snapshot=snapshots.find(s=>s.id===e.snapshotId);const url=e.episodeId?`https://softmax.com/observatory/v2/episode-requests/${encodeURIComponent(e.episodeId)}/watch`:snapshot?.document.source;return <p key={id}>{e.detail}{url?<> <a href={url} target="_blank" rel="noreferrer">{e.episodeId?'Episode':'League source'} ↗</a></>:null}</p>;})}</details>
  </article>)}</div>
  {model.unknowns.length?<div><h4>Still unknown</h4><ul>{model.unknowns.map((u,i)=><li key={i}>{u}</li>)}</ul></div>:null}
  {model.nextTests.length?<div><h4>Next tests</h4><ul>{model.nextTests.map((t,i)=><li key={i}>{t}</li>)}</ul></div>:null}
  <details><summary>Evidence sources · {model.evidence.length}</summary>{model.evidence.map(e=>{const snapshot=snapshots.find(s=>s.id===e.snapshotId);const url=e.episodeId?`https://softmax.com/observatory/v2/episode-requests/${encodeURIComponent(e.episodeId)}/watch`:snapshot?.document.source;return <div key={e.id}><p>{e.detail}</p>{url?<a href={url} target="_blank" rel="noreferrer">{e.episodeId?'Episode':'League source'} ↗</a>:null}<small>Snapshot {e.snapshotId}{snapshot?` · ${new Date(snapshot.collected_at).toLocaleString()}`:''}</small></div>;})}</details>
  <details><summary>Semantic IR</summary><pre className="opponent-ir">{JSON.stringify(model,null,2)}</pre></details>
 </section>;
}
