import {z} from 'zod';
import type {PolicyExplanation} from './policy-explorer';
export const editRequestSchema=z.object({id:z.uuid(),policyId:z.uuid(),sourceHash:z.string().length(64),sectionId:z.string().max(200),intent:z.string().trim().min(8).max(4000)});
export type SemanticEditRequest=z.infer<typeof editRequestSchema>;
export type EditorCandidate={id:string;policy_id:string;state:string;input:SemanticEditRequest;candidate:{sectionId:string;base:PolicyExplanation;source:string;sourceHash:string;summary:string;start:number;end:number;replacement:string;semantic:{condition:string;action:string;goal:string;hypothesis:string;expected:string;non_trigger:string}}|null;error:string|null;xp_id:string|null;policy_version_id:string|null;result:{status:string;completed_count:number;failed_count:number;episodes:{id:string;status:string;episode_id?:string|null;replay_url?:string|null}[]}|null;created_at:string;updated_at:string;deadline_at?:string|null};
/** Map untouched spans through the replacement; overlaps resolve to the changed semantic rule. */
export function mappedSpan(section:{start:number;end:number},edit:{start:number;end:number;replacement:string}|null){
 if(!edit)return section;const delta=edit.replacement.length-(edit.end-edit.start);
 if(section.end<=edit.start)return section;if(section.start>=edit.end)return {start:section.start+delta,end:section.end+delta};
 return {start:Math.min(section.start,edit.start),end:Math.max(edit.start+edit.replacement.length,section.end+delta)};
}
export function sourceLines(source:string){let offset=0;return source.split('\n').map((text,index)=>{const line={text,line:index+1,start:offset,end:offset+text.length};offset+=text.length+1;return line;});}
export function ruleAtOffset(sections:PolicyExplanation['sections'],offset:number,edit:EditorCandidate['candidate']=null){
 if(edit&&offset>=edit.start&&offset<edit.start+edit.replacement.length)return edit.sectionId;
 return sections.filter(s=>{const span=mappedSpan(s,edit);return offset>=span.start&&offset<span.end;}).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0]?.id;
}
