import {z} from 'zod';

export const replayEpisodeSchema=z.object({
  id:z.string().regex(/^ereq_[0-9a-f-]{36}$/i),status:z.string(),created_at:z.string(),
  replay_url:z.string().nullable(),round:z.object({id:z.string(),number:z.number()}),
  outcome:z.enum(['won','lost','time_limit']).nullable(),score:z.number().nullable(),
  side:z.enum(['Red','Blue']).nullable(),seats:z.array(z.number().int().nonnegative()),
  opponents:z.array(z.object({policy:z.string(),player:z.string().nullable()})),
});
export const replayPageSchema=z.object({policyVersionId:z.string(),episodes:z.array(replayEpisodeSchema),nextCursor:z.string().nullish()});
export type ReplayEpisode=z.infer<typeof replayEpisodeSchema>;
export const replaySessionSchema=z.object({viewer_url:z.string().min(1),ready:z.boolean(),episode_id:z.string().nullish()}).transform(data=>({url:data.viewer_url,ready:data.ready,episodeId:data.episode_id??undefined}));
export const playableReplay=(episode:ReplayEpisode)=>episode.status==='completed'&&!!episode.replay_url;
export function selectReplay(episodes:ReplayEpisode[],selectedId:string){
  return episodes.find(e=>e.id===selectedId&&playableReplay(e))??episodes.find(playableReplay);
}
