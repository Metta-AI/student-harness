import { z } from 'zod';
import { opponentSemanticSchema, type OpponentSemanticIR } from './semantic-model';
export const opponentNoteSchema=z.object({
  kind:z.enum(['observation','hypothesis']),
  text:z.string().trim().min(8).max(3000),
  evidence:z.array(z.object({label:z.string().trim().min(1).max(200),url:z.url().refine(s=>{const u=new URL(s);return u.protocol==='https:'&&(u.hostname==='softmax.com'||u.hostname.endsWith('.softmax.com'));},'Use a Softmax evidence link')})).min(1).max(10),
}).strict();
export const opponentToolSchema=z.object({
  action:z.enum(['list','read','collect','note','save_model']),
  policyId:z.uuid().optional().describe('Required for read, collect and note. Use an exact policy version ID from list.'),
  episodeIds:z.array(z.string().regex(/^ereq_[a-zA-Z0-9-]+$/)).min(1).max(10).optional().describe('For collect: attach specific episodes discovered through the CLI. Server verifies league and exact policy membership.'),
  model:opponentSemanticSchema.optional().describe('Required for save_model. Cite snapshot IDs from read, link semantic nodes, and preserve uncertainty.'),
  note:opponentNoteSchema.optional().describe('Required for note. Distinguish a hypothesis from an observation and cite evidence.'),
}).strict().superRefine((v,c)=>{if(v.action!=='list'&&!v.policyId)c.addIssue({code:'custom',path:['policyId'],message:'Policy ID required'});if(v.action==='save_model'&&!v.model)c.addIssue({code:'custom',path:['model'],message:'Semantic model required'});if(v.action==='note'&&!v.note)c.addIssue({code:'custom',path:['note'],message:'Note required'});});
export type OpponentProfile={policyId:string;policyLabel:string;playerId:string|null;playerName:string|null;rank:number|null;rating:number|null;ratingLabel:string|null;episodes:number;own:boolean;current?:boolean};
export type OpponentResearchStatus={policyId:string;hasNotes:boolean;hasModel:boolean};
export type OpponentSnapshot={profile:OpponentProfile;collectedAt:string;source:string;coverage:string;hasMore:boolean;warning?:string;episodes:{id:string;status:string;round:number;createdAt:string;scores:{position:number;score:number}[];replay:boolean;participants:{position:number;policy_version_id?:string;policy_name?:string;player_name?:string|null}[]}[]};
export type OpponentNotebook={tasks?:{id:string;objective:string;status:string;context?:{title?:string}}[];models:{id:string;created_at:string;actor:string;document:OpponentSemanticIR}[];sessions:{session_id:string;title:string|null;updated_at:string}[];snapshots:{id:string;collected_at:string;document:OpponentSnapshot}[];notes:{id:string;actor:string;kind:string;text:string;evidence:{label:string;url:string}[];created_at:string}[]};
