"use client";

import {gameCapabilities} from '../../lib/workspace/game-capabilities';
import composerStyles from './composer-controls.module.css';
import {useRef,useState} from "react";
import {Textarea} from "@/components/ui/textarea";
import {SelectField} from "@/components/ui/select-field";
import {ArrowUp,BookOpen,ChartNoAxesCombined,FlaskConical,Play,Route} from "lucide-react";
import {composerModes,type ComposerMode} from "../../lib/workspace/composer";
import {chatModels,modelLabels,isChatModel} from "../../lib/model-selection";
import {permissionOptions,researchModeOptions} from "../use-chat-settings";
import {usePersistentDraft} from "../use-persistent-draft";
import {agentModeOptions,useAgentMode} from "../use-agent-mode";
import {reasoningEfforts,reasoningLabels,isReasoningEffort} from "../../lib/reasoning";
import type {ChatSettings} from "../use-chat-settings";

const suggestions=[
  {label:'Learn my policy',mode:'learn',icon:BookOpen,text:'Explain how my current policy plays and where it could improve.'},
  {label:'Coach a replay',mode:'do',icon:Play,text:'Find a replay where my coaching would help. Show me the moment and ask what I would do differently.'},
  {label:'Compare policies',mode:'view',icon:ChartNoAxesCombined,text:'Compare my latest policies using available results. Show what improved and what is still untested.'},
  {label:'Run autoresearch',mode:'research',icon:FlaskConical,text:'Investigate what is holding my policy back in this league and work on improving it.'},
] as const;
const selectorStyle="h-8 border-0 bg-transparent px-1.5 text-xs text-[#617357] shadow-none hover:bg-[#eff2e6]";

export function WorkspaceComposer({disabled,settings,onRequest,leagueId}:{leagueId?:string;disabled:boolean;settings:ChatSettings;onRequest:(requestId:string,description:string,mode:ComposerMode)=>void}) {
  const [agentMode,setAgentMode]=useAgentMode();
  const [description,setDescription] = usePersistentDraft(`composer:${leagueId??"default"}`);
  const [mode,setMode]=useState<ComposerMode>('auto');
  const input=useRef<HTMLTextAreaElement>(null);
  const policyExecution=!leagueId||gameCapabilities(leagueId).basicPolicyWorkspace;
  const prompts=policyExecution?suggestions:[{label:'Learn this game',mode:'learn' as const,icon:BookOpen,text:'Read this game’s current rules and participation guide. Explain the decisions a policy needs to make.'},{label:'Review the league',mode:'view' as const,icon:ChartNoAxesCombined,text:'Review this league’s current standings and recent rounds. Show the evidence and what we can learn.'},{label:'Develop a strategy',mode:'do' as const,icon:Route,text:'Help me develop a policy for this game. Read its policy interface and rules, then help me draft decision rules and a test plan in a workspace tab.'}];
  const locked=disabled||settings.modelSettingsSaving;
  return <section className="workspace-composer" aria-label="Ask Preston">
    <label htmlFor="workspace-prompt" className="sr-only">Ask Preston</label>
    <form onSubmit={event=>{
      event.preventDefault();if(locked||!settings.modelSettingsReady||!description.trim())return;
      onRequest(crypto.randomUUID(),description.trim(),mode);
      setDescription("");
    }}>
      <Textarea ref={input} id="workspace-prompt" className="min-h-24 rounded-none border-0 bg-transparent px-0 text-[15px] text-[#304d38] shadow-none focus-visible:ring-0" value={description} onChange={event=>setDescription(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form?.requestSubmit();}}} rows={3} maxLength={4000} required placeholder={composerModes.find(item=>item.value===mode)!.placeholder}/>
      <div className="workspace-composer-toolbar">
        <div className="workspace-composer-options">
          <SelectField className={composerStyles.model} contentClassName={composerStyles.modelMenu} aria-label="Agent" value={agentMode} disabled={locked} onValueChange={value=>{if(value==="preston"||value==="hermes")setAgentMode(value);}} options={[...agentModeOptions]}/><SelectField className={composerStyles.model} contentClassName={composerStyles.modelMenu} aria-label="Preston model" value={settings.chatModel} disabled={locked} onValueChange={value=>{if(isChatModel(value))settings.onChatModel(value);}} options={chatModels.map(model=>({value:model,label:modelLabels[model]}))}/><SelectField className={composerStyles.model} contentClassName={composerStyles.modelMenu} aria-label="Tool permissions" value={settings.permissionMode} disabled={locked} onValueChange={value=>{if(value==="ask"||value==="auto")settings.onPermissionMode(value);}} options={[...permissionOptions]}/><SelectField className={composerStyles.model} contentClassName={composerStyles.modelMenu} aria-label="Research mode" value={settings.researchMode} disabled={locked} onValueChange={value=>{if(value==="standard"||value==="extreme")settings.onResearchMode(value);}} options={[...researchModeOptions]}/>
          <SelectField className={selectorStyle} aria-label="Thinking effort" value={settings.reasoningEffort} disabled={locked} onValueChange={value=>{if(isReasoningEffort(value))settings.onReasoningEffort(value);}} options={reasoningEfforts.map(effort=>({value:effort,label:`${reasoningLabels[effort].label} thinking`}))}/>
        </div>
        <button className={`workspace-composer-send ${composerStyles.send}`} type="submit" aria-label="Send to Preston" title="Send to Preston" disabled={locked||!settings.modelSettingsReady||!description.trim()}><ArrowUp size={21}/></button>
      </div>
    </form>
    {mode==='research'?<p className="workspace-composer-note">Research continues in the Lab, within your workspace limits.</p>:null}
    {settings.error?<p role="alert">{settings.error}{!settings.modelSettingsReady?<button className="text-button" disabled={settings.modelSettingsSaving} onClick={settings.retrySettings}>Retry settings</button>:null}</p>:null}
    <div className="workspace-composer-suggestions" aria-label="Suggested requests">{prompts.map(({label,mode:nextMode,icon:Icon,text})=><button key={label} type="button" disabled={locked} onClick={()=>{setMode(nextMode);setDescription(text);input.current?.focus();}}><Icon size={15} aria-hidden="true"/>{label}</button>)}</div>
  </section>;
}
