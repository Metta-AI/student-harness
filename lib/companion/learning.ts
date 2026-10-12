import {z} from 'zod';

export const learningEvidenceSchema=z.object({kind:z.enum(['desktop_moment','frame','moment','revision','experiment','replay_observation','container_revision','practice']),id:z.string().min(1).max(200)}).strict();
const evidence=z.array(learningEvidenceSchema).max(12);
const text=z.string().trim().min(8).max(3000);
export const learningCreateSchema=z.object({question:text,objective:text,focus:z.enum(['policy','human','collaboration']),mode:z.enum(['explore','delegate']).default('explore'),cycleId:z.uuid().optional(),evidence:evidence.min(1)}).strict();
export const learningEntrySchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('prediction'),text,expected:text,falsifier:text,evidence:evidence.default([]),supersedes:z.uuid().optional()}),
 z.object({type:z.literal('observation'),text,evidence:evidence.min(1),supersedes:z.uuid().optional()}),
 z.object({type:z.literal('debrief'),text,predictionId:z.uuid(),finding:z.enum(['supported','contradicted','inconclusive']),evidence:evidence.min(1),supersedes:z.uuid().optional()}),
 z.object({type:z.literal('lesson'),text,debriefId:z.uuid(),appliesWhen:text,falsifier:text,evidence:evidence.min(1),supersedes:z.uuid().optional()}),
]);
export const learningControlSchema=z.object({revision:z.number().int().positive(),mode:z.enum(['explore','delegate']),status:z.enum(['active','closed'])}).strict();
export const learningExperimentSchema=z.object({predictionId:z.uuid(),cycleId:z.uuid(),baselineId:z.uuid(),mode:z.enum(['baseline','candidate']),objective:z.string().trim().min(12).max(2000),criteria:z.string().trim().min(12).max(2000),rationale:z.string().trim().min(12).max(2000),maxCalls:z.number().int().min(6).max(100).default(24)}).strict();
export const learningMutationSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('experiment'),requestKey:z.string().min(8).max(160),studyId:z.uuid(),experiment:learningExperimentSchema}),
 z.object({action:z.literal('experiment_control'),requestKey:z.string().min(8).max(160),studyId:z.uuid(),planId:z.uuid(),command:z.enum(['start','cancel'])}),
 z.object({action:z.literal('create'),requestKey:z.string().min(8).max(160),study:learningCreateSchema}),
 z.object({action:z.literal('append'),requestKey:z.string().min(8).max(160),studyId:z.uuid(),entry:learningEntrySchema}),
 z.object({action:z.literal('control'),requestKey:z.string().min(8).max(160),studyId:z.uuid(),control:learningControlSchema}),
]);
export const learningToolSchema=z.object({
 action:z.enum(['list','read','create','append','experiment']),studyId:z.uuid().optional(),before:z.number().int().positive().optional(),
 entryId:z.uuid().optional().describe('For read: fetch one original entry by ID, including correction and evidence availability, without paging through history.'),
 evidence:learningEvidenceSchema.optional().describe('For list: find studies started from this exact evidence record.'),
 study:learningCreateSchema.omit({mode:true}).optional(),entry:learningEntrySchema.optional(),experiment:learningExperimentSchema.optional(),
}).superRefine((p,ctx)=>{
 if(p.entryId&&(p.action!=='read'||p.before!==undefined))ctx.addIssue({code:'custom',message:'An entry ID requires read without a history cursor'});
 if((p.action==='read'||p.action==='append'||p.action==='experiment')&&!p.studyId)ctx.addIssue({code:'custom',message:'Provide studyId'});
 if(p.action==='create'&&!p.study)ctx.addIssue({code:'custom',message:'Provide study'});
 if(p.action==='experiment'&&!p.experiment)ctx.addIssue({code:'custom',message:'Provide experiment'});
 if(p.action==='append'&&!p.entry)ctx.addIssue({code:'custom',message:'Provide entry'});
});
export type LearningEvidence=z.infer<typeof learningEvidenceSchema>;
export type LearningStudy={id:string;league_id:string;question:string;objective:string;focus:'policy'|'human'|'collaboration';mode:'explore'|'delegate';status:'active'|'closed';revision:number;actor:'human'|'preston';cycle_id:string|null;anchors:EvidenceSnapshot[];created_at:string;updated_at:string};
export type EvidenceSnapshot=LearningEvidence&{eventId?:string;href?:string;positionMs?:number;recordingHash?:string;revision?:number;availability?:string;[key:string]:unknown};
export type LearningEntry={id:string;sequence:number;isCurrent?:boolean;correctedBy?:string|null;actor:'human'|'preston'|'system';created_at:string;supersedes:string|null;payload:{studyId:string;entryType:string;text:string;input:Record<string,unknown>;learningEvidence:EvidenceSnapshot[]}};
export type LearningDetail={study:LearningStudy;entries:LearningEntry[];hasMore:boolean;nextBefore:number|null;contract:string};
export type LearningEntryDetail={entry:LearningEntry;contract:string;href:string};
export const learningContract='Predictions and debrief findings are attributed judgments, not verified causal results. Lessons are revisable proposals, not joint agreement. Evidence snapshots describe what was linked when written; reread evidence for corrections, withdrawal or expiry. Study controls never grant spending, games or device access. Preserve prediction timestamps: a prediction written after seeing an outcome is not prospective evidence.';

export type StudyResearch={cycles:{id:string;question:string;active_version_id:string;state:string;autonomy:boolean;expires_at:string|null;call_limit:number;calls_allocated:number;game_limit:number;games_allocated:number}[];experiments:{plan_id:string;prediction_id:string;base_version_id:string;actor:string;created_at:string;plan:{id:string;objective:string;mode:string;status:string;task_id:string|null;max_calls:number};task:{id:string;status:string;reason:string|null;games_requested:number;model_calls:number}|null}[]};
