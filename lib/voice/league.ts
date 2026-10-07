import leagueConfig from '../../league.json' with {type:'json'};
import { db } from '../db';
import { getLeague,getCompetitionDivision,getPolicyLeaderboard,getLeagueStandings,listLeagueSubmissions } from '../softmax';
import { leagueRecord } from '../league-record';
export async function readLiveLeague(student:string,token:string,includeRecord=false) {
  const signal = AbortSignal.timeout(12_000);
  const ownVersions = db().from('policy_versions').select('softmax_policy_version_id').eq('student_id', student).abortSignal(signal).then(({data,error}) => { if(error) throw new Error('Policy lookup unavailable'); return data ?? []; });
  const [league,board,submissions,versions]=await Promise.all([getLeague(token,signal),getCompetitionDivision(token,signal).then(async division => { const [policies, standings] = await Promise.all([getPolicyLeaderboard(token,division.id,signal), getLeagueStandings(token,division.id,signal)]); return {policies:policies??[],standings}; }),listLeagueSubmissions(token,signal),ownVersions]);
  const entered=submissions.filter(s=>!['rejected','withdrawn'].includes(s.status));
  const ownIds=new Set([...versions.map(v=>v.softmax_policy_version_id),...entered.map(s=>s.policy_version?.id)]);
  const ownPlayers=new Set([...board.policies.filter(p=>ownIds.has(p.policy_version_id)).map(p=>p.player_id),...entered.map(s=>s.player?.id)]);
  const mine=board.standings.filter(p=>ownPlayers.has(p.player_id));
  const selected=entered[0]?.policy_version?.id;
  const record=includeRecord&&selected?await leagueRecord(token,selected).catch(()=>null):null;
  const row=(p:typeof board.standings[number])=>({rank:p.rank,playerId:p.player_id,policy:p.policy_label,player:p.player_name,score:p.score,metric:p.score_label,rounds:p.rounds_played});
  return {checkedAt:new Date().toISOString(),league:{id:league.id,name:league.name,url:leagueConfig.url,roundsPaused:!!league.rounds_paused_at,submissionsLocked:!!league.submissions_locked_at},recordWindowHours:72,rankingMetric:"player MMR",
    entries:board.standings.length,leaders:board.standings.slice(0,10).map(row),ourPolicies:mine.map(row),submittedPolicyIds:entered.map(s=>s.policy_version?.id).filter(Boolean),record:record?{policyVersionId:selected,...record}:null,
    gapToLeader:mine[0]&&board.standings[0]?board.standings[0].score-mine[0].score:null,
    interpretation:'Fresh query of the configured league, not research-cycle state. An empty workspace or missing submission does not mean the league has not started. Rankings use official player MMR across policy versions; episode records are policy-specific over 72 hours; time limits are not wins. The score gap is descriptive, not a guaranteed path to rank 1. Inspect episodes before prescribing strategy changes.',
  };
}
