"use client";
import {readAgentMode} from "../use-agent-mode";
import {findingReferenceSchema,type FindingReference} from '../../lib/companion/finding-discussion';
import {gameCapabilities,gameWorkspacePanels} from '../../lib/workspace/game-capabilities';
import {useCallback,useEffect,useState} from 'react';
import {z} from 'zod';
import {composerModes,type ComposerMode} from '../../lib/workspace/composer';
import {workspaceRequestSchema,workspaceRequestRoute,workspaceRequestLocation,newSessionShortId,type WorkspaceRequest} from '../../lib/workspace/request';
import {codingWorkspacePanels} from '../../lib/workspace/coding-workspace';
import {instantiateWorkspaceTemplate} from '../../lib/workspace/templates';
import {replayFromPrompt} from '../../lib/workspace/replay-analysis';
export type {WorkspaceRequest} from '../../lib/workspace/request';

export function useWorkspaceRequests(subjectId:string,leagueId:string){
  const key=subjectId?`preston-workspace-requests:${subjectId}:${leagueId}`:'';
  const [state,setState]=useState<{key:string;requests:WorkspaceRequest[];selected:string|null;open:boolean}>({key:'',requests:[],selected:null,open:false});
  const [route,setRoute]=useState('');
  const [routeError,setRouteError]=useState('');
  const [loading,setLoading]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const navigate=useCallback((url:string,replace=false)=>{
    if(`${location.pathname}${location.search}`!==url)window.history[replace?'replaceState':'pushState'](null,'',url);
    setRoute(`${location.pathname}${location.search}`);
  },[]);
  useEffect(()=>{const restore=()=>setRoute(`${location.pathname}${location.search}`);restore();window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);},[]);
  useEffect(()=>{
    let requests:WorkspaceRequest[]=[];
    try{requests=z.array(workspaceRequestSchema).parse(JSON.parse(localStorage.getItem(key)??'[]'));}catch{/* Invalid local history cannot block the workspace. */}
    setState({key,requests,selected:null,open:false});
  },[key]);
  useEffect(()=>{
    if(!key)return;
    const abort=new AbortController();
    void fetch('/api/chats',{signal:abort.signal}).then(async response=>{
      if(!response.ok)return;
      const data=await response.json();
      const saved:WorkspaceRequest[]=(data.chats??[]).flatMap((chat:{workspace_request?:unknown})=>{
        const raw=chat.workspace_request as {leagueId?:string}|undefined;
        if(raw?.leagueId!==leagueId)return [];
        const parsed=workspaceRequestSchema.safeParse(raw);return parsed.success?[parsed.data]:[];
      });
      setState(s=>s.key===key?{...s,requests:[...s.requests,...saved.filter(r=>!s.requests.some(local=>local.sessionId===r.sessionId||local.id===r.id))]}:s);
    }).catch(()=>{/* Cached history remains available when the server is offline. */});
    return()=>abort.abort();
  },[key,leagueId]);
  useEffect(()=>{if(!key||state.key!==key)return;try{localStorage.setItem(key,JSON.stringify(state.requests));}catch{/* The durable Eve session is also saved in history. */}},[key,state]);
  useEffect(()=>{
    if(!key||state.key!==key)return;
    const {session,id,shortId}=workspaceRequestLocation(route);
    setRouteError('');
    if(!session&&!id&&!shortId){setLoading(false);setState(s=>s.open?{...s,open:false}:s);return;}
    const found=state.requests.find(r=>shortId?r.shortId===shortId:session?r.sessionId===session:r.id===id);
    if(found){setLoading(false);setState(s=>s.selected===found.id&&s.open?s:{...s,selected:found.id,open:true});return;}
    setState(s=>({...s,selected:null,open:false}));
    if(!session&&!shortId){setLoading(false);setRouteError('This unsent request is not saved in this browser. Start a new request.');return;}
    const abort=new AbortController();setLoading(true);
    void fetch(`/api/chats?${new URLSearchParams({...shortId?{short:shortId}:{session:session!},league:leagueId})}`,{signal:abort.signal}).then(async response=>{
      if(!response.ok)throw new Error(response.status===404?'This conversation was not found in this league.':'Could not load this conversation. Try again.');
      const data=await response.json();const saved=data.chat?.workspace_request;
      if(saved?.leagueId!==leagueId)throw new Error('This conversation belongs to another league.');
      const request=workspaceRequestSchema.parse(saved);
      if(session&&request.sessionId!==session||shortId&&request.shortId!==shortId)throw new Error('This conversation could not be restored.');
      setState(s=>s.key===key?{...s,requests:[request,...s.requests.filter(r=>r.id!==request.id)],selected:request.id,open:true}:s);
    }).catch(error=>{if(!abort.signal.aborted)setRouteError(error.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[key,state.key,route,leagueId,attempt]);
  const start=useCallback((id:string,prompt:string,mode:ComposerMode,policyId:string,templateId?:string,findingReference?:FindingReference)=>{
    if(!composerModes.some(item=>item.value===mode))return;
    if(findingReference&&(!findingReferenceSchema.safeParse(findingReference).success||findingReference.leagueId!==leagueId))return;
    const supported=gameCapabilities(leagueId).basicPolicyWorkspace;
    if(!supported&&mode==='research')mode='auto';
    const request:WorkspaceRequest={id,shortId:newSessionShortId(),agentMode:readAgentMode(),prompt,mode,policyId,token:crypto.randomUUID(),pinned:false,...findingReference?{findingReference}:{},...mode==='research'?{tabs:structuredClone(codingWorkspacePanels),activeTabId:'coding-terminal',workspaceTitle:'Autoresearch'}:{},...templateId&&supported?instantiateWorkspaceTemplate(templateId):{},...!supported?{tabs:gameWorkspacePanels(),activeTabId:'league-context'}:{}};
    const replays=supported?replayFromPrompt(prompt).slice(0,12):[];
    if(replays.length){request.tabs=[...(request.tabs??[]),...replays];request.activeTabId=replays[0].id;request.workspaceTitle='Replay analysis';}
    setState(previous=>({key,requests:[request,...(previous.key===key?previous.requests:[]).filter((r,i)=>r.pinned||i<19)],selected:id,open:true}));
    navigate(workspaceRequestRoute(request,leagueId));
  },[key,leagueId,navigate]);
  const update=useCallback((id:string,patch:Partial<WorkspaceRequest>)=>setState(s=>s.key===key?{...s,requests:s.requests.map(r=>r.id===id?{...r,...patch,id:r.id}:r)}:s),[key]);
  const open=useCallback((id:string)=>{
    const request=state.requests.find(r=>r.id===id);if(!request)return;
    setState(s=>s.key===key?{...s,selected:id,open:true}:s);
    navigate(workspaceRequestRoute(request,leagueId));
  },[key,state.requests,leagueId,navigate]);
  const close=useCallback(()=>{setState(s=>({...s,open:false}));navigate(`/?view=performance&league=${encodeURIComponent(leagueId)}`);},[leagueId,navigate]);
  const requests=state.key===key?state.requests:[];
  const current=requests.find(r=>r.id===state.selected);
  // Old query links remain readable; migrate them after the short link is saved.
  useEffect(()=>{const address=workspaceRequestLocation(route);if(state.open&&current?.shortId&&(address.session===current.sessionId&&!!address.session||address.id===current.id)&&route!==workspaceRequestRoute(current,leagueId))navigate(workspaceRequestRoute(current,leagueId),true);},[state.open,current,route,leagueId,navigate]);
  return {requests,current,isOpen:state.key===key&&state.open,loading,routeError,retry:()=>setAttempt(n=>n+1),href:(r:WorkspaceRequest)=>workspaceRequestRoute(r,leagueId),start,update,open,close};
}
