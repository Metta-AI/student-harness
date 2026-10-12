import {z} from 'zod';
import {leagueIdSchema} from './league-catalog';
import {episodeRequestIdSchema} from './workspace/replay-analysis';
import {getCompetitionRound,getEpisodeRequest,getEpisodeResults,listRoundEpisodeRequests} from './softmax';

export const roundIdSchema=z.string().regex(/^round_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const leagueReplaySelectionSchema=z.object({
 roundId:roundIdSchema.optional(),episodeId:episodeRequestIdSchema.optional(),cursor:z.string().min(1).max(1000).optional(),
}).strict().refine(p=>!!p.roundId!==!!p.episodeId,'Provide one round or episode').refine(p=>!p.cursor||!!p.roundId,'Cursor requires a round');
export const leagueReplayReadSchema=leagueReplaySelectionSchema.safeExtend({leagueId:leagueIdSchema});
export class LeagueReplayScopeError extends Error {}
const watchURL=(id:string)=>`https://softmax.com/observatory/v2/episode-requests/${encodeURIComponent(id)}/watch`;
async function scopedRound(token:string,leagueId:string,roundId:string,signal?:AbortSignal){
 const round=await getCompetitionRound(token,roundId,signal);
 if(round.id!==roundId||round.division.league.id!==leagueId)throw new LeagueReplayScopeError('This round does not belong to the selected league.');
 return {id:round.id,number:round.round_number,status:round.status,createdAt:round.created_at,division:round.division.name,leagueId,leagueName:round.division.league.name};
}
/** Scope comes from the episode's own round, never from a caller-provided replay URL or game ID. */
export async function scopedLeagueEpisode(token:string,leagueId:string,episodeId:string,signal?:AbortSignal){
 leagueIdSchema.parse(leagueId);episodeRequestIdSchema.parse(episodeId);
 const episode=await getEpisodeRequest(token,episodeId,signal);
 if(episode.id!==episodeId||!episode.round_id)throw new LeagueReplayScopeError('This episode is not a league round episode.');
 const round=await scopedRound(token,leagueId,roundIdSchema.parse(episode.round_id),signal);
 return {episode,round};
}
type Results=Awaited<ReturnType<typeof getEpisodeResults>>;
function participants(result:Results[number]|undefined){
 const scores=new Map((result?.participant_scores??[]).map(s=>[s.position,s.score]));
 // Seat is the platform roster position, not a country ID, team, or inferred game outcome.
 const rows=new Map((result?.participants??[]).map(p=>[p.position,{position:p.position,policyId:p.policy_version_id??null,policy:p.policy_name?`${p.policy_name}${p.version===undefined?'':`:v${p.version}`}`:null,player:p.player_name??null,score:scores.get(p.position)??null}]));
 for(const [position,score] of scores)if(!rows.has(position))rows.set(position,{position,policyId:null,policy:null,player:null,score});
 return [...rows.values()].sort((a,b)=>a.position-b.position);
}
export async function readLeagueReplays(token:string,input:unknown,signal=AbortSignal.timeout(15000)){
 const p=leagueReplayReadSchema.parse(input);
 const scoped=p.episodeId?await scopedLeagueEpisode(token,p.leagueId,p.episodeId,signal):null;
 const round=scoped?.round??await scopedRound(token,p.leagueId,p.roundId!,signal);
 const page=scoped?{entries:[scoped.episode],next_cursor:null}:await listRoundEpisodeRequests(token,round.id,p.cursor,signal);
 if(page.entries.some(e=>e.round_id!==round.id))throw new LeagueReplayScopeError('Episode evidence does not match the selected round.');
 let results:Results=[],warning:string|null=null;
 try{results=await getEpisodeResults(token,page.entries.map(e=>e.id),signal);}catch{signal.throwIfAborted();warning='Participant scores could not load. Missing scores are not zero.';}
 return {round,episodes:page.entries.map(e=>{const result=results.find(r=>r.id===e.id);return {
  id:e.id,status:e.status,createdAt:e.created_at??null,replayAvailable:!!e.replay_url&&!!e.coworld_id,
  watchURL:watchURL(e.id),participants:participants(result),scoresAvailable:!!result?.participant_scores,
 };}),nextCursor:page.next_cursor??null,warning,checkedAt:new Date().toISOString()};
}
export type LeagueReplayEvidence=Awaited<ReturnType<typeof readLeagueReplays>>;
