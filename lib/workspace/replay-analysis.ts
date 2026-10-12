import {z} from 'zod';

export const episodeRequestIdSchema=z.string().regex(/^ereq_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
/** Recognize explicit episode references, never treat an arbitrary URL as a replay source. */
export function replayFromPrompt(prompt:string){
  const ids=[...new Set(prompt.match(/\bereq_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)??[])];
  return ids.map(episodeId=>({id:`replay:${episodeId}`,kind:'replay' as const,title:'Replay analysis',episodeId}));
}
export const replayMomentSchema=z.object({id:z.string(),tick:z.number().int().nonnegative().nullable(),position:z.number().int().nonnegative().nullable(),text:z.string().max(4000)});
export type ReplayMoment=z.infer<typeof replayMomentSchema>;
export const replayAnalysisSchema=z.object({
  id:episodeRequestIdSchema,status:z.string(),createdAt:z.string().nullable(),game:z.string().nullable(),episodeId:z.string().nullable(),replayAvailable:z.boolean(),
  participants:z.array(z.object({position:z.number(),policyId:z.string().nullable(),policy:z.string(),player:z.string().nullable(),score:z.number().nullable()})),
  stats:z.object({steps:z.number().nullable(),game_stats:z.record(z.string(),z.number()),policy_stats:z.array(z.object({position:z.number(),policy_name:z.string().nullable(),avg_reward:z.number(),avg_metrics:z.record(z.string(),z.number())}))}).nullable(),
  warnings:z.array(z.string()),
});
export type ReplayAnalysis=z.infer<typeof replayAnalysisSchema>;
export function replayTick(data:unknown){
  const parsed=z.object({src:z.literal('coworld-replay'),type:z.literal('tick'),tick:z.number().int().nonnegative(),playing:z.boolean()}).safeParse(data);
  return parsed.success?parsed.data:null;
}
