import {z} from 'zod';
import {db} from '../db';
import {leagueIdSchema} from '../league-catalog';
import {episodeRequestIdSchema} from '../workspace/replay-analysis';
import {scopedLeagueEpisode} from '../league-replays';
import {ownedContainerPracticeStatus} from '../container-policy/practice-status';

export const replayObservationScopeSchema=z.object({leagueId:leagueIdSchema,episodeId:episodeRequestIdSchema,practiceId:z.uuid().optional()}).strict();
export const replayObservationWriteSchema=replayObservationScopeSchema.extend({requestKey:z.string().min(8).max(160),text:z.string().min(1).max(4000).refine(v=>v.trim().length>0),phase:z.string().max(160).default(''),supersedes:z.uuid().optional()});
type Scope=z.infer<typeof replayObservationScopeSchema>;
type ObservationRow={id:string;student_id:string;league_id:string;episode_id:string;practice_id:string|null;text:string;phase:string;supersedes:string|null;request_key:string;created_at:string;source:Record<string,unknown>};
const columns='id,student_id,league_id,episode_id,practice_id,text,phase,supersedes,request_key,created_at,source';
export class ReplayObservationError extends Error{status:number;constructor(message:string,status=400){super(message);this.status=status;}}
export const replayObservationsEnabled=()=>process.env.GENERIC_LEARNING_ENABLED==='1';
function project(row:ObservationRow,correctedBy:string|null=null){return {id:row.id,text:row.text,phase:row.phase,supersedes:row.supersedes,isCurrent:!correctedBy,correctedBy,leagueId:row.league_id,episodeId:row.episode_id,practiceId:row.practice_id,createdAt:row.created_at};}
function query(student:string,p:Scope){let q=db().from('replay_observations').select(columns).eq('student_id',student).eq('league_id',p.leagueId).eq('episode_id',p.episodeId);q=p.practiceId?q.eq('practice_id',p.practiceId):q.is('practice_id',null);return q;}
async function corrections(student:string,p:Scope,ids:string[]){
 if(!ids.length)return [] as ObservationRow[];
 const r=await query(student,p).in('supersedes',ids).limit(50).abortSignal(AbortSignal.timeout(10000));
 if(r.error)throw new ReplayObservationError('Observation corrections could not load. Please retry.',503);
 return r.data as ObservationRow[];
}
export async function readReplayObservations(student:string,input:unknown){
 const p=replayObservationScopeSchema.parse(input);
 if(!replayObservationsEnabled())return {enabled:false,observations:[],limited:false};
 const r=await query(student,p).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(51).abortSignal(AbortSignal.timeout(10000));
 if(r.error)throw new ReplayObservationError('Replay observations could not load. Please retry.',503);
 const rows=(r.data as ObservationRow[]).slice(0,50),newer=await corrections(student,p,rows.map(o=>o.id));
 return {enabled:true,observations:rows.map(o=>project(o,newer.find(n=>n.supersedes===o.id)?.id??null)),limited:r.data.length>50};
}
/** Browser-only human writing boundary. Provider/journal provenance is never accepted from the caller. */
export async function saveReplayObservation(student:string,token:string,input:unknown){
 const p=replayObservationWriteSchema.parse(input);
 if(!replayObservationsEnabled())throw new ReplayObservationError('Replay observations are not enabled yet.',503);
 const prior=await db().from('replay_observations').select(columns).eq('student_id',student).eq('request_key',p.requestKey).limit(1).abortSignal(AbortSignal.timeout(10000)).maybeSingle();
 if(prior.error)throw new ReplayObservationError('Observation status could not load. Retry with the same request.',503);
 if(prior.data){
  const row=prior.data as ObservationRow;
  if(row.league_id!==p.leagueId||row.episode_id!==p.episodeId||row.practice_id!==(p.practiceId??null)||row.text!==p.text||row.phase!==p.phase||row.supersedes!==(p.supersedes??null))throw new ReplayObservationError('This save request was already used for different content.',409);
  const newer=await corrections(student,p,[row.id]);return {observation:project(row,newer[0]?.id??null)};
 }
 let source:Record<string,unknown>;
 if(p.practiceId){
  const practice=await ownedContainerPracticeStatus(student,p.leagueId,p.practiceId).catch(error=>{if(error instanceof Error&&error.message==='Container practice not found in this account and league')throw new ReplayObservationError('Practice not found in this account and league.',404);throw error;});
  if(!practice.result?.terminal||!practice.requestId||!practice.result.episodes.some(e=>e.id===p.episodeId))throw new ReplayObservationError('This episode is not a verified completed practice in this league.',404);
  source={kind:'practice',leagueId:p.leagueId,episodeId:p.episodeId,practiceId:p.practiceId,requestId:practice.requestId,coworldId:practice.coworldId,manifestHash:practice.manifestHash,gameVersion:practice.gameVersion,verifiedAt:new Date().toISOString()};
 }else{
  const {episode,round}=await scopedLeagueEpisode(token,p.leagueId,p.episodeId,AbortSignal.timeout(15000));
  source={kind:'league_replay',leagueId:p.leagueId,episodeId:p.episodeId,coworldId:episode.coworld_id,roundId:round.id,verifiedAt:new Date().toISOString()};
 }
 const r=await db().rpc('replay_observation_write',{p_student:student,p_league:p.leagueId,p_key:p.requestKey,p_episode:p.episodeId,p_practice:p.practiceId??null,p_text:p.text,p_phase:p.phase,p_supersedes:p.supersedes??null,p_source:source}).abortSignal(AbortSignal.timeout(10000));
 if(r.error)throw new ReplayObservationError('Observation could not be saved. Reload to check for a newer correction, then retry.',409);
 const row=r.data as ObservationRow;
 return {observation:project(row)};
}
