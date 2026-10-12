"use client";
import {useCallback,useEffect,useState} from "react";

export type AgentMode="preston"|"hermes";
export const agentModeOptions=[{value:"preston",label:"Preston"},{value:"hermes",label:"Hermes"}] as const;
const KEY="preston-agent-mode";
/** The agent new conversations start with; remembered in this browser. */
export function readAgentMode():AgentMode{try{return localStorage.getItem(KEY)==="hermes"?"hermes":"preston";}catch{return "preston";}}
export function useAgentMode(){
  const [mode,setMode]=useState<AgentMode>("preston");
  useEffect(()=>{setMode(readAgentMode());},[]);
  const change=useCallback((next:AgentMode)=>{setMode(next);try{localStorage.setItem(KEY,next);}catch{}},[]);
  return [mode,change] as const;
}
