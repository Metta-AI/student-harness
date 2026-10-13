import { z } from 'zod';

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const timezoneSchema = z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Choose a valid timezone');
export const responsibilitySchema = z.object({
  requestKey: z.uuid(), objective: z.string().trim().min(12).max(2000),
  criteria: z.string().trim().min(12).max(2000),
  triggerKind: z.enum(['interval', 'daily', 'moment', 'experiment.finished', 'evidence.corrected', 'task.finished', 'external.observation']),
  externalSourceId:z.uuid().optional(),
  studyId:z.uuid().optional(), followUpExperiments:z.boolean().default(false),
  intervalMinutes: z.number().int().min(60).max(10080).default(1440),
  timezone: timezoneSchema.default('UTC'), dailyTime: clockTime.default('09:00'),
  maxRuns: z.number().int().min(1).max(100), maxCalls: z.number().int().min(6).max(100).default(12),
  maxCostUsd: z.number().positive().max(25).default(1),
  expiresAt: z.iso.datetime(),
}).refine(v=>(v.triggerKind==='external.observation')===!!v.externalSourceId,'Choose one external source only for an external observation trigger')
 .refine(v=>!v.followUpExperiments||!!v.studyId,'Choose a study for follow-up experiments');
export const attentionSchema = z.object({
  timezone: timezoneSchema, quietStart: clockTime.nullable(), quietEnd: clockTime.nullable(),
  activity: z.enum(['available', 'playing', 'quiet']),
  durationMinutes: z.number().int().min(1).max(240).default(60),
}).refine(v => (v.quietStart === null && v.quietEnd === null) ||
  (v.quietStart !== null && v.quietEnd !== null && v.quietStart !== v.quietEnd), 'Choose two different quiet-hour times');
export const companionMutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), input: responsibilitySchema }),
  z.object({ action: z.literal('edit'), id: z.uuid(), revision: z.number().int().nonnegative(), input: responsibilitySchema }),
  z.object({ action: z.enum(['pause', 'resume', 'stop']), id: z.uuid(), revision: z.number().int().nonnegative() }),
  z.object({ action: z.literal('attention'), input: attentionSchema }),
  z.object({ action: z.enum(['read', 'dismiss']), id: z.uuid() }),
]);
export type ResponsibilityInput = z.infer<typeof responsibilitySchema>;
export type CompanionMutation = z.infer<typeof companionMutationSchema>;
export type Responsibility = {
  id: string; league_id?:string; revision: number; objective: string; criteria: string; status: 'active'|'paused'|'completed';
  trigger_kind: ResponsibilityInput['triggerKind']; interval_minutes: number; timezone: string; daily_time: string;
  runs: number; max_runs: number; max_calls: number; max_cost_usd: number; expires_at: string;
  next_due_at: string; active_task_id: string|null;
  external_source_id?:string|null;
  study_id?:string|null; follow_up_experiments?:boolean;
};
export type CompanionUpdate = { id: string; league_id?:string; task_id: string; study_id?:string|null; title: string; outcome: string; finding?: string|null;
  delivery: 'inbox'|'deferred'; decision_reason: string; created_at: string; read_at: string|null };
export type Attention = { timezone: string; quiet_start: string|null; quiet_end: string|null;
  activity: 'available'|'playing'|'quiet'; activity_until: string|null };
export type ResponsibilityFeed = { leagueId?:string; reviewsEnabled?:boolean; responsibilities: Responsibility[]; updates: CompanionUpdate[]; attention: Attention|null; held: boolean };
