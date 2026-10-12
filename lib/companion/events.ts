import {z} from 'zod';
export const eventPageQuery=z.object({
 leagueId:z.string().regex(/^league_[a-zA-Z0-9_-]+$/).max(100).default('league_3c60897b-25cf-4b37-9d1a-8554c1198f28'),
 after:z.string().refine(s=>/^(0|[1-9]\d{0,18})$/.test(s)&&BigInt(s)<=9223372036854775807n,'Invalid event cursor').optional(),
 limit:z.coerce.number().int().min(1).max(50).default(25),
}).strict();
export const companionStatusQuery=eventPageQuery.extend({view:z.enum(['overview','activity']).default('overview')});
export type CompanionEvent={id:string;sequence:string;schemaVersion:1;kind:'moment'|'evidence.corrected'|'experiment.finished'|'task.finished'|'task.needs_input'|'task.control'|'external.observation'|'desktop.command'|'desktop.control';source:'desktop'|'research'|'hosted-results'|'task'|'integration';actor:'human'|'preston'|'system';priority:number;leagueId:string;cycleId:string|null;causationId:string|null;occurredAt:string;publishedAt:string;trust:'evidence-only';sourceRef:{kind:'research_event';id:string};summary:string;superseded:boolean;taskId:string|null;momentId:string|null};
export type CompanionEventPage={events:CompanionEvent[];nextCursor:string;hasMore:boolean;published:number};
export const eventLabels:Record<CompanionEvent['kind'],string>={moment:'Marked moment','evidence.corrected':'Evidence corrected','experiment.finished':'Experiment result','task.finished':'Investigation finished','task.needs_input':'Decision needed','task.control':'Work updated','external.observation':'External observation','desktop.command':'Replay command','desktop.control':'Replay control'};
export function mergeCompanionEvents(current:CompanionEvent[],incoming:CompanionEvent[]){
 const rows=new Map(current.map(row=>[row.id,row]));for(const row of incoming)rows.set(row.id,row);
 const superseded=new Set([...rows.values()].flatMap(row=>row.causationId?[row.causationId]:[]));
 return [...rows.values()].map(row=>superseded.has(row.id)?{...row,superseded:true}:row)
  .sort((a,b)=>BigInt(a.sequence)>BigInt(b.sequence)?-1:BigInt(a.sequence)<BigInt(b.sequence)?1:0).slice(0,50);
}
