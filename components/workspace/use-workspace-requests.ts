"use client";
import {useCallback,useEffect,useState} from 'react';
import {z} from 'zod';
import {composerModes,type ComposerMode} from '../../lib/workspace/composer';
import {viewSchema} from '../../lib/workspace/presentation';

const requestSchema=z.object({id:z.string(),prompt:z.string(),mode:z.enum(['auto','learn','do','view','research']),policyId:z.string(),sessionId:z.string().optional(),token:z.string(),view:viewSchema.optional(),pinned:z.boolean().default(false)});
export type WorkspaceRequest=z.infer<typeof requestSchema>;
export function useWorkspaceRequests(subjectId:string,leagueId:string){
  const key=subjectId?`preston-workspace-requests:${subjectId}:${leagueId}`:'';
  const [state,setState]=useState<{key:string;requests:WorkspaceRequest[];selected:string|null;open:boolean}>({key:'',requests:[],selected:null,open:false});
  useEffect(()=>{
    let requests:WorkspaceRequest[]=[];
    try{requests=z.array(requestSchema).parse(JSON.parse(localStorage.getItem(key)??'[]'));}catch{/* Invalid local history cannot block the workspace. */}
    setState({key,requests,selected:null,open:false});
  },[key]);
  useEffect(()=>{if(!key||state.key!==key)return;try{localStorage.setItem(key,JSON.stringify(state.requests));}catch{/* The durable Eve session is also saved in history. */}},[key,state]);
  const start=useCallback((id:string,prompt:string,mode:ComposerMode,policyId:string)=>{
    if(!composerModes.some(item=>item.value===mode))return;
    const request:WorkspaceRequest={id,prompt,mode,policyId,token:crypto.randomUUID(),pinned:false};
    setState(previous=>({key,requests:[request,...(previous.key===key?previous.requests:[]).filter((r,i)=>r.pinned||i<19)],selected:id,open:true}));
  },[key]);
  const update=useCallback((id:string,patch:Partial<WorkspaceRequest>)=>setState(s=>s.key===key?{...s,requests:s.requests.map(r=>r.id===id?{...r,...patch,id:r.id}:r)}:s),[key]);
  const open=useCallback((id:string)=>setState(s=>s.key===key?{...s,selected:id,open:true}:s),[key]);
  const close=useCallback(()=>setState(s=>({...s,open:false})),[]);
  const requests=state.key===key?state.requests:[];
  return {requests,current:requests.find(r=>r.id===state.selected),isOpen:state.key===key&&state.open,start,update,open,close};
}
