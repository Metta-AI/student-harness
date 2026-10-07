"use client";
import { useCallback,useEffect,useState } from "react";
import { CompanionProvider,useCompanion } from "./partner/companion";
import { PresentPanel } from "./partner/present-card";
import { GamePicker } from "./partner/game-navigation";
import { AccountMenu } from "./partner/account-menu";
import { GeneratedView } from "./workspace/generated-view";
import type { LeagueOverview } from "../lib/league-overview";
import type { WorkspaceView } from "../lib/workspace/presentation";
import { leagueURL } from "../lib/league-catalog";
import { SelectField } from "./ui/select-field";
import { PerformanceLeaderboard, PerformanceOverview } from "./workspace/performance-overview";

export function LeagueExplorer({leagueId}:{leagueId:string}){
  return <CompanionProvider leagueId={leagueId}><Explorer leagueId={leagueId}/></CompanionProvider>;
}
function Explorer({leagueId}:{leagueId:string}){
  const companion=useCompanion();
  const [session,setSession]=useState<{email:string|null;name?:string;subjectId?:string}|null>(null);
  const [data,setData]=useState<LeagueOverview|null>(null),[error,setError]=useState(""),[division,setDivision]=useState(""),[tick,setTick]=useState(0);
  const [compact,setCompact]=useState(false);
  const [selectedPlayerId,setSelectedPlayerId]=useState("");
  useEffect(()=>{const mq=window.matchMedia("(max-width: 800px)");const update=()=>setCompact(mq.matches);update();mq.addEventListener("change",update);return()=>mq.removeEventListener("change",update);},[]);
  const [tab,setTab]=useState("performance"),[expanded,setExpanded]=useState(false),[views,setViews]=useState<{id:string;title:string}[]>([]);
  const [token,setToken]=useState(""),[signing,setSigning]=useState(false);
  useEffect(()=>{void fetch('/api/session').then(r=>r.json()).then(setSession).catch(()=>setError("Could not load your account."));},[]);
  useEffect(()=>{
    if(!session?.email)return;
    const abort=new AbortController();let generation=0;
    const refresh=async()=>{const own=++generation;try{
      const r=await fetch(`/api/league-overview?league=${encodeURIComponent(leagueId)}${division?`&division=${encodeURIComponent(division)}`:""}`,{signal:abort.signal,cache:'no-store'});
      if(!r.ok)throw Error();const result=await r.json();if(!abort.signal.aborted&&own===generation){setData(result);setError("");}
    }catch{if(!abort.signal.aborted&&own===generation)setError("Could not refresh this league. Retry");}};
    setData(null);void refresh();const timer=setInterval(()=>void refresh(),60000);
    return()=>{abort.abort();clearInterval(timer);};
  },[session?.email,leagueId,division,tick]);
  useEffect(()=>{
    if(!session?.email)return;const abort=new AbortController();
    void fetch(`/api/views?league=${encodeURIComponent(leagueId)}`,{signal:abort.signal}).then(async r=>{if(r.ok)setViews((await r.json()).views);}).catch(()=>{});
    return()=>abort.abort();
  },[session?.email,leagueId,companion.presentation.state.current?.artifactId]);
  const openView=useCallback((view:WorkspaceView)=>{setTab(view.view==='custom'?view.artifactId??'performance':view.view==='episodes'?'episodes':'performance');setExpanded(false);},[]);
  useEffect(()=>companion.presentation.bind(openView),[companion.presentation.bind,openView]);
  useEffect(()=>{companion.presentation.setHuman({tab,leagueId,divisionId:data?.division?.id??null,game:data?.league.game.name??null});},[tab,leagueId,data,companion.presentation.setHuman]);
  const pending=companion.presentation.state.current;
  async function signIn(e:React.FormEvent){e.preventDefault();setSigning(true);setError("");try{const r=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});if(!r.ok)throw Error();setSession(await r.json());setToken("");}catch{setError("Could not sign in. Check your Softmax token.");}finally{setSigning(false);}}
  async function signOut(){const r=await fetch('/api/session',{method:'DELETE'});if(!r.ok)throw Error();companion.stopTalk();companion.stopScreen();window.location.assign('/');}
  const standings=data?.standings??[], mine=standings.filter(r=>data?.ownPlayers.includes(r.player_id));
  const activePlayerId=mine.find(p=>p.player_id===selectedPlayerId)?.player_id??mine[0]?.player_id;
  if(!session?.email)return <main className="shell"><header className="topbar"><a href="/" className="brand">Softmax</a><a href={leagueURL(leagueId)} target="_blank" rel="noreferrer">Open league ↗</a></header><div className="intro"><h1>Explore with Preston.</h1></div>{session?<form className="card league-signin" onSubmit={signIn}><label>Softmax user token<input type="password" value={token} onChange={e=>setToken(e.target.value)} autoComplete="off" required/></label><button disabled={signing}>{signing?'Connecting…':'Connect account'}</button><a href="https://softmax.com/cli-auth" target="_blank" rel="noreferrer">Get a token ↗</a></form>:<p>Loading your account…</p>}{error?<p role="status">{error}</p>:null}</main>;
  const names={game:data?.league.game.name??"Softmax",league:data?.league.name??"League"};
  return <main className="shell signed-in partner-shell league-explorer">
    <header className="partner-header" inert={compact&&expanded}><div className="partner-brand"><a href="/">Softmax</a><GamePicker leagueId={leagueId} gameName={names.game} leagueName={names.league} disabled={false} onSelect={()=>setTab('performance')}/></div></header>
    <div className="partner-body" inert={compact&&expanded}>
      <section className="preview-card" onPointerDownCapture={companion.presentation.manual}>
        <div className="tabs" role="tablist" aria-label="League views"><div>{['performance','episodes'].map(t=><button key={t} role="tab" aria-selected={tab===t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t==='performance'?'Performance':'Rounds'}</button>)}</div><a href={data?.league.url??leagueURL(leagueId)} target="_blank" rel="noreferrer">Softmax ↗</a></div>
        {views.length||pending?<div className="generated-view-tabs" role="tablist" aria-label="Additional views">{pending&&pending.view!=='custom'?<button role="tab" aria-selected={false} onClick={()=>openView(pending)}>{pending.view==='episodes'?'Rounds':'Performance'} · Preston</button>:null}{views.map(v=><button key={v.id} role="tab" aria-selected={tab===v.id} onClick={()=>setTab(v.id)}>{v.title}</button>)}</div>:null}
        <div className="workspace-tab league-explorer-content">
          <div className="league-overview-heading"><div><h2>{tab==='performance'?'Performance':tab==='episodes'?'Rounds':'Analysis'}</h2><p>{names.league}{data?.division?` · ${data.division.name}`:''}</p></div><button className="text-button" onClick={()=>setTick(t=>t+1)}>Refresh</button></div>
          {data&&data.divisions.length>1?<SelectField aria-label="League division" value={data.division?.id??''} onValueChange={setDivision} options={data.divisions.map(d=>({value:d.id,label:d.name}))}/>:null}
          {error?<p role="status"><button className="text-button" onClick={()=>setTick(t=>t+1)}>{error}</button></p>:null}
          {!data&&!error?<p>Loading league results…</p>:null}
          {data&&tab==='performance'?<>
            {mine.length>1?<div className="performance-player-picker"><SelectField aria-label="Your league player" value={activePlayerId??""} onValueChange={setSelectedPlayerId} options={mine.map(p=>({value:p.player_id,label:`${p.player_name??p.player_id} · ${p.policy_label??"Current policy"}`}))}/></div>:null}
            <PerformanceOverview standings={standings} activePlayerId={activePlayerId} leagueName={names.game} />
            <p className="league-data-note">{data.league.disabled_at?'Archived league':data.league.rounds_paused_at?'Rounds paused':'Active league'} · {data.division?.name??'No divisions yet'} · Updated {new Date(data.checkedAt).toLocaleTimeString()}</p>
            <PerformanceLeaderboard key={`${leagueId}:${data.division?.id}`} standings={standings} ownPlayerIds={data.ownPlayers} activePlayerId={activePlayerId}/>
          </>:null}
          {data&&tab==='episodes'?<div className="workspace-table-scroll"><table className="workspace-table" aria-label="League rounds"><thead><tr><th>Round</th><th>Status</th><th>Started</th><th>Finished</th></tr></thead><tbody>{data.rounds.map(r=><tr key={r.id}><td><a href={`https://softmax.com/observatory/v2?tab=coworlds&detail=${encodeURIComponent(`round:${r.id}`)}`} target="_blank" rel="noreferrer">#{r.round_number} ↗</a></td><td>{r.status}</td><td>{new Date(r.created_at).toLocaleString()}</td><td>{r.completed_at?new Date(r.completed_at).toLocaleString():'—'}</td></tr>)}{!data.rounds.length?<tr><td colSpan={4}>No rounds in this division yet.</td></tr>:null}</tbody></table>{data.hasMoreRounds?<a href={data.league.url} target="_blank" rel="noreferrer">More rounds on Softmax ↗</a>:null}</div>:null}
          {views.some(v=>v.id===tab)?<GeneratedView id={tab} leagueId={leagueId}/>:null}
          <div className="league-reference-links">{data?.league.participation_url?<a href={data.league.participation_url} target="_blank" rel="noreferrer">League guide ↗</a>:null}{data?.league.wiki_markdown_url?<a href={data.league.wiki_markdown_url} target="_blank" rel="noreferrer">Game reference ↗</a>:null}<a href="/">GoTA policy workspace ↗</a></div>
        </div>
        <AccountMenu name={session.name||session.email.split('@')[0]} email={session.email} disabled={false} onSignOut={signOut}/>
      </section>
    </div>
    <PresentPanel expanded={expanded} busy={false} activity={null} waiting={0} navigationDisabled={false} onClose={()=>setExpanded(false)} feed={{campaigns:[],tasks:[],workers:[],loaded:true,error:'',refresh:async()=>{},upsert:()=>{}}}>{null}</PresentPanel>
    <button id="present-panel-toggle" className="preston-mobile-launcher" type="button" hidden={expanded} aria-label="Open Preston" onClick={()=>setExpanded(true)}><img src="/preston/preston-kindred-wisp.webp" width={52} height={52} alt=""/></button>
  </main>;
}
