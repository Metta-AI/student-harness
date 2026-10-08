"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import {defaultChatModel,isChatModel,type ChatModel} from "../lib/model-selection";
import {defaultReasoningEffort,isReasoningEffort,type ReasoningEffort} from "../lib/reasoning";

/** One saved selection for both the Workspace and conversation composers. */
export function useChatSettings(user:string|null) {
  const [chatModel,setChatModel]=useState<ChatModel>(defaultChatModel);
  const [reasoningEffort,setReasoningEffort]=useState<ReasoningEffort>(defaultReasoningEffort);
  const [modelSettingsSaving,setSaving]=useState(true);
  const [modelSettingsReady,setReady]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const [error,setError]=useState("");
  const saving=useRef(false);
  const currentUser=useRef(user);currentUser.current=user;
  useEffect(()=>{
    const abort=new AbortController();setSaving(true);setReady(false);setError("");
    setChatModel(defaultChatModel);setReasoningEffort(defaultReasoningEffort);
    if(!user)return()=>abort.abort();
    void fetch('/api/preferences',{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(10000)])}).then(async response=>{
      if(!response.ok)throw Error();
      const data=await response.json();
      if(abort.signal.aborted)return;
      if(isChatModel(data.chatModel))setChatModel(data.chatModel);
      if(isReasoningEffort(data.reasoningEffort))setReasoningEffort(data.reasoningEffort);
      setReady(true);
    }).catch(()=>{if(!abort.signal.aborted)setError('Settings couldn’t load. Choose a model to save your selection.');})
      .finally(()=>{if(!abort.signal.aborted)setSaving(false);});
    return()=>abort.abort();
  },[user,attempt]);
  const change=useCallback(async(patch:{chatModel?:ChatModel;reasoningEffort?:ReasoningEffort})=>{
    if(saving.current||!user)return;
    saving.current=true;setSaving(true);setError("");
    try {
      const response=await fetch('/api/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch),signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error();
      const data=await response.json();
      if(currentUser.current!==user)return;
      if(isChatModel(data.chatModel))setChatModel(data.chatModel);
      if(isReasoningEffort(data.reasoningEffort))setReasoningEffort(data.reasoningEffort);
      setReady(true);
    }catch{if(currentUser.current===user)setError('Settings weren’t saved. Your previous selection is still active. Try again.');}
    finally{saving.current=false;if(currentUser.current===user)setSaving(false);}
  },[user]);
  const onChatModel=useCallback((model:ChatModel)=>{void change({chatModel:model});},[change]);
  const onReasoningEffort=useCallback((effort:ReasoningEffort)=>{void change({reasoningEffort:effort});},[change]);
  const retrySettings=useCallback(()=>setAttempt(value=>value+1),[]);
  return {chatModel,reasoningEffort,modelSettingsSaving,modelSettingsReady,onChatModel,onReasoningEffort,retrySettings,error};
}
export type ChatSettings=ReturnType<typeof useChatSettings>;
