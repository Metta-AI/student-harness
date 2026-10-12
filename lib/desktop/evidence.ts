import {z} from 'zod';
export const deviceSecretSchema=z.string().regex(/^[a-f0-9]{64}$/);
export const recordingSchema=z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/),name:z.string().min(1).max(255).refine(s=>!/[\\/\x00]/.test(s),'Use a file name, not a path'),sizeBytes:z.number().int().positive().max(1099511627776)}).strict();
export const desktopMomentSchema=z.object({
 action:z.enum(['upsert','withdraw']),momentId:z.uuid(),baseRevision:z.number().int().nonnegative(),recording:recordingSchema,
 positionMs:z.number().int().nonnegative(),durationMs:z.number().int().positive().max(604800000),
 note:z.string().trim().max(4000),observedAt:z.iso.datetime(),policyVersionId:z.uuid().nullable().default(null),
 episodeId:z.string().trim().min(1).max(200).nullable().default(null),cycleId:z.uuid().nullable().default(null),
}).strict().refine(m=>m.positionMs<=m.durationMs,'Moment is outside this recording')
 .refine(m=>m.action==='withdraw'||m.note.length>0,'Write an observation before sharing');
export const syncEnvelopeSchema=z.object({deviceId:z.uuid(),operationId:z.uuid(),input:desktopMomentSchema}).strict();
export const deviceActionSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('pair'),deviceId:z.uuid(),name:z.string().trim().min(1).max(100),secret:deviceSecretSchema}).strict(),
 z.object({action:z.literal('revoke'),deviceId:z.uuid()}).strict(),
]);
