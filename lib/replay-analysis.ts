import {getEpisodeRequest,getEpisodeResults,getEpisodeStats} from './softmax';
import type {ReplayAnalysis} from './workspace/replay-analysis';

/** Read exactly one episode under the caller's Softmax credentials. No historical scans or research jobs. */
export async function readReplayAnalysis(token:string,id:string):Promise<ReplayAnalysis>{
  const episode=await getEpisodeRequest(token,id);
  const [results,stats]=await Promise.allSettled([getEpisodeResults(token,[id]),getEpisodeStats(token,id)]);
  const result=results.status==='fulfilled'?results.value.find(row=>row.id===id):undefined;
  const scores=new Map((result?.participant_scores??[]).map(row=>[row.position,row.score]));
  return {
    id:episode.id,status:episode.status,createdAt:episode.created_at??null,game:episode.coworld_name??null,episodeId:episode.episode_id,replayAvailable:!!episode.replay_url,
    participants:(result?.participants??[]).map(row=>({position:row.position,policyId:row.policy_version_id??null,policy:row.policy_name?`${row.policy_name}${row.version===undefined?'':`:v${row.version}`}`:'Human / unlabelled policy',player:row.player_name??null,score:scores.get(row.position)??null})),
    stats:stats.status==='fulfilled'?stats.value:null,
    warnings:[...results.status==='rejected'||!result?['Participants and scores could not load.']:[],...stats.status==='rejected'?['Episode statistics are unavailable.']:[]],
  };
}
