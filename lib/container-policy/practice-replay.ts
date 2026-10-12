import {ownedContainerPracticeStatus} from './practice-status';
import {getEpisodeRequest} from '../softmax';
import {episodeRequestIdSchema} from '../workspace/replay-analysis';
import {LeagueReplayScopeError} from '../league-replays';
/** A practice is scoped by its owned terminal journal, not by a league round. */
export async function scopedPracticeEpisode(student:string,token:string,leagueId:string,practiceId:string,episodeId:string,signal?:AbortSignal){
 episodeRequestIdSchema.parse(episodeId);
 const practice=await ownedContainerPracticeStatus(student,leagueId,practiceId).catch(error=>{if(error instanceof Error&&error.message==='Container practice not found in this account and league')throw new LeagueReplayScopeError('Practice not found in this account and league.');throw error;});
 if(!practice.result?.terminal||!practice.requestId||!practice.result.episodes.some(e=>e.id===episodeId))throw new LeagueReplayScopeError('This episode is not part of a verified practice in this league.');
 const episode=await getEpisodeRequest(token,episodeId,signal);
 if(episode.id!==episodeId||episode.coworld_id!==practice.coworldId||episode.policy_version_ids.length!==practice.seatCount||episode.policy_version_ids.some(id=>id!==practice.policyVersionId))throw new LeagueReplayScopeError('The replay does not match this practice game and roster.');
 return episode;
}
