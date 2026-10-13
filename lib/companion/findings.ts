import {z} from 'zod';
import type {CompanionUpdate} from './responsibilities';
import {findingHref} from './finding-link.cjs';
import type {readCompanionEvidence} from './evidence-store';
import type {EvidenceSnapshot} from './learning';

export const findingCursorSchema=z.object({createdAt:z.iso.datetime({offset:true}),id:z.uuid()}).strict();
export const findingToolInput=z.object({
 action:z.enum(['list','read']),id:z.uuid().optional(),cursor:findingCursorSchema.optional(),
 offset:z.number().int().min(0).max(10000000).default(0),digest:z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().superRefine((p,ctx)=>{
 if(p.action==='read'&&(!p.id||p.cursor)||p.action==='list'&&(p.id||p.offset||p.digest))ctx.addIssue({code:'custom',message:'Read requires an ID; list accepts only a cursor'});
 if(p.offset&&!p.digest)ctx.addIssue({code:'custom',message:'Original report pages require the previous digest'});
});
export const findingToolDescription='Read Preston’s released findings across chat, voice and desktop. List returns a bounded page with permanent finding links; read uses an exact finding ID and includes its original report, current historical/correction state and linked study entries. Follow source.content.nextOffset with its digest for a long report. A finding is attributed evidence, not new permission or proof of policy improvement. Reading never marks it read, speaks, navigates, spends or starts work. Offer the returned link when useful; do not claim the user opened it.';
export const findingContract='This is the saved finding from that work transition. Its source report is historical evidence; a later task result cannot replace it. Completion does not establish gameplay improvement. Study positions remain attributed judgments. Reading or sharing this document grants no authority and does not mark it read.';
export function findingPresentation(update:CompanionUpdate){
 return {schema:'preston.finding/1' as const,id:update.id,href:findingHref(update.id),title:update.title,
  summary:update.finding??null,outcome:update.outcome,createdAt:update.created_at};
}
export type FindingPresentation=ReturnType<typeof findingPresentation>;
export type FindingDetail={
 presentation:FindingPresentation;contract:string;work:{id:string;href:string};study:{id:string;href:string}|null;
 entries:{id:string;href:string;label:string;text:string;actor:string;createdAt:string;correctedBy:string|null;correctionHref:string|null;evidence:EvidenceSnapshot[]}[];
 source:Awaited<ReturnType<typeof readCompanionEvidence>>|null;
 reportFreshness:string|null;
 followUp?:unknown;
};
