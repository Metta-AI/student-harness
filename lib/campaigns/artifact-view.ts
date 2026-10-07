type View={view?:'summary'|'timeline'|'full';slot?:number;tickStart?:number;tickEnd?:number};
/** Presentation only: preserve immutable full evidence; make partial reads explicit. */
export function artifactView(row:any,options:View={}){
 if(!row||options.view==='full')return row;
 if(row.kind==='candidate-probe'){
  const {source,proposal,...content}=row.content??{};
  return {...row,content:{...content,sourceAvailable:typeof source==='string',
   proposalSummary:proposal?.summary??content.proposalSummary,
   componentIds:proposal?.components?.map((component:any)=>component.id)??content.componentIds},
   view:options.view??'summary',note:'Compact diagnostic receipt. Read view=full for the exact source and component edits when sourceAvailable is true. Older receipts may not contain source; do not infer it from a printed label.'};
 }
 const c=row.content,native=c?.audit?.result??c?.outcome?.evidence?.native,s=native?.simulation;
 if(!s)return row;
 const {samples=[],milestones=[],item_actions=[],objective_events=[],objective_effects=[],subject_events=[],...final}=s;
 const {evidence,...outcome}=c.outcome??{};
 const slot=options.slot??s.subject??c.slot??evidence?.slot??native.vm?.subject;
 const within=(r:any)=>typeof r.tick==='number'&&r.tick>=(options.tickStart??0)&&r.tick<=(options.tickEnd??Infinity);
 const selectedSamples=samples.filter((r:any)=>options.tickStart===undefined&&options.tickEnd===undefined||within(r));
 const selectedMilestones=milestones.filter(within),selectedActions=item_actions.filter(within),selectedObjectives=objective_events.filter(within);
 const selectedEffects=objective_effects.filter(within),selectedSubjectEvents=subject_events.filter(within);
 const timeline=options.view==='timeline'?{
  samples:selectedSamples.slice(0,100).map((r:any)=>({...r,heroes:slot===undefined?r.heroes:r.heroes?.filter((h:any)=>h.slot===slot)})),
  // Action/milestone ledgers are for the decoder's subject only, never relabel another seat.
  milestones:slot===s.subject?selectedMilestones.slice(0,200):[],
  item_actions:slot===s.subject?selectedActions.slice(0,200):[],
  objective_events:selectedObjectives.slice(0,200),
  objective_effects:selectedEffects.slice(0,200),
  subject_events:slot===s.subject?selectedSubjectEvents.slice(0,200):[],
  matchedCounts:{samples:selectedSamples.length,milestones:slot===s.subject?selectedMilestones.length:0,item_actions:slot===s.subject?selectedActions.length:0,objective_events:selectedObjectives.length,objective_effects:selectedEffects.length,subject_events:slot===s.subject?selectedSubjectEvents.length:0},
  truncated:selectedSamples.length>100||selectedObjectives.length>200||selectedEffects.length>200||slot===s.subject&&(selectedMilestones.length>200||selectedActions.length>200||selectedSubjectEvents.length>200)||!!s.timeline_truncated,
 }:undefined;
 return {id:row.id,artifactId:row.artifactId??row.id,kind:row.kind,title:row.title,provenance:row.provenance,
  content:{episodeId:c.episodeId??c.outcome?.episodeId,slot,release:c.release??evidence?.release,sourceHash:c.sourceHash,
   replayHash:c.replayHash??c.outcome?.replayHash,...(c.outcome?{outcome}:{}),
   audit:{status:c.audit?.status??'completed',jobId:c.jobId??c.audit?.jobId,result:{
    release:native.release,replayHash:native.replayHash,engines:native.engines,vm:native.vm,
    simulation:{...final,sample_count:samples.length,item_action_count:item_actions.length,milestone_count:milestones.length,objective_event_count:s.objective_event_count??objective_events.length,
     objective_effect_count:s.objective_effect_count??objective_effects.length,subject_event_count:s.subject_event_count??subject_events.length,
     timelineAvailability:{samples:Array.isArray(s.samples),item_actions:Array.isArray(s.item_actions),milestones:Array.isArray(s.milestones),objective_events:Array.isArray(s.objective_events),objective_effects:Array.isArray(s.objective_effects),subject_events:Array.isArray(s.subject_events)},...timeline},instrumentNames:Object.keys(native.events??{}),
   }}},
  view:options.view??'summary',note:'Compact projection of recorded evidence. Use view=timeline with a subject slot and total-tick range; view=full returns every original field and instrument output. objective_events describe omniscient structure health; objective_effects attribute actual damage/deaths using pinned engine events. subject_events include the decoder subject’s XP awards, portal lifecycle and item consumption/purchases; they are not another seat’s ledger. XP reward source is not necessarily kill credit. Events do not establish policy visibility or competitive causality. Item commands remain simulation.item_actions. If timelineAvailability is false, inspect the same replay again to refresh it without a hosted game. Old samples without total tick cannot be filtered by total-tick range. Absence of timeline entries is not evidence that no action occurred.'};
}
