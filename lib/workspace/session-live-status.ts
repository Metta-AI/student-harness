import {sessionProgress} from './session-progress';

export type LiveEvent = {type:string;meta?:{at?:string};data?:unknown};
const toolLabels:Record<string,string>={list_policy_versions:'Loading saved policies',live_league:'Checking league results',research_campaign:'Checking the research campaign',autoresearch:'Checking research settings',read_file:'Reading policy evidence',compose_workspace:'Updating the workspace',create_view:'Preparing findings',bash:'Running a command'};
const terminalLabels:Record<string,string>={setup:'Preparing the coding environment',run:'Running a terminal command',inspect:'Reading workspace files',start_loop:'Starting autoresearch',resume_loop:'Resuming autoresearch',loop_status:'Checking autoresearch progress',stop_loop:'Stopping autoresearch'};
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'?value as Record<string,unknown>:{};
const time=(event:LiveEvent)=>{const value=Date.parse(event.meta?.at??'');return Number.isFinite(value)?value:null;};

/** Only server events count as activity; reconnecting or ticking the UI never resets its age. */
export function sessionLiveStatus(events:readonly LiveEvent[],transport:string,starting:boolean,now:number,openedAt:number){
 const progress=sessionProgress(events,transport,starting);
 let start=0;
 for(let i=0;i<events.length;i++)if(events[i].type==='message.received'||events[i].type==='turn.started')start=i;
 const current=transport==='submitted'?[]:events.slice(start);
 const recent:{label:string;at:number|null;failed:boolean}[]=[];
 for(const event of current){
  const data=record(event.data);
  let label='';let failed=false;
  switch(event.type){
   case 'message.received':case 'turn.started':label='Request received';break;
   case 'step.started':label='Waiting for the model';break;
   case 'reasoning.appended':case 'reasoning.completed':label='Model is thinking';break;
   case 'message.appended':case 'message.completed':label='Writing an update';break;
   case 'actions.requested':{
    const actions=Array.isArray(data.actions)?data.actions:[];
    label=actions.map(action=>{const a=record(action),input=record(a.input);const name=String(a.toolName??'');return name==='research_terminal'?terminalLabels[String(input.action)]??'Using the coding environment':toolLabels[name]??name.replaceAll('_',' ');}).filter(Boolean).join(' · ')||'Starting requested tools';break;
   }
   case 'action.partial':{
    const result=record(data.result),output=record(result.output),loop=record(output.loop);
    label=typeof loop.status==='string'?`Autoresearch ${loop.status}${typeof loop.turn==='number'?` · turn ${loop.turn}`:''}`:output.phase==='preparing'?'Preparing the coding environment':output.phase==='running'?'Receiving terminal output':'Tool progress received';break;
   }
   case 'action.result':failed=data.status==='failed';label=failed?'Tool reported an error':data.status==='rejected'?'Tool request declined':'Tool result received';break;
   case 'step.failed':case 'turn.failed':case 'session.failed':label='Execution reported an error';failed=true;break;
   case 'turn.completed':case 'session.completed':label='Finished';break;
   case 'turn.cancelled':label='Stopped';break;
   case 'input.requested':label='Waiting for your input';break;
  }
  if(!label)continue;
  const item={label,at:time(event),failed};
  if(recent.at(-1)?.label===label)recent[recent.length-1]=item;else recent.push(item);
 }
 const lastAt=current.map(time).filter((at):at is number=>at!==null).at(-1)??null;
 const startedAt=current.map(time).find(at=>at!==null)??openedAt;
 const age=Math.max(0,Math.floor((now-(lastAt??openedAt))/1000));
 const active=progress.working||transport==='streaming';
 const connecting=progress.phase==='connecting';
 const quiet=(active||connecting)&&age>=45;
 const label=connecting?'Reconnecting to the session':active?(recent.at(-1)?.label??'Waiting for the session to start'):progress.label;
 return {label,active,connecting,quiet,failed:progress.phase==='failed',age,lastAt,elapsed:Math.max(0,Math.floor((now-startedAt)/1000)),recent:recent.slice(-4)};
}
export function durationLabel(seconds:number){return seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}m ${seconds%60}s`;}
