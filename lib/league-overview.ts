import { getCatalogLeague,listLeagueDivisions,getCompetitionStandings,listLeagueSubmissions,listCompetitionRounds } from "./softmax";
import { leagueURL } from "./league-catalog";
export async function readLeagueOverview(token:string,leagueId:string,requestedDivision?:string){
  const signal=AbortSignal.timeout(12000);
  const [league,divisions,submissions]=await Promise.all([getCatalogLeague(token,leagueId,signal),listLeagueDivisions(token,leagueId,signal),listLeagueSubmissions(token,signal,leagueId)]);
  const division=requestedDivision?divisions.find(d=>d.id===requestedDivision):divisions.find(d=>d.type==="competition")??divisions[0];
  if(requestedDivision&&!division)throw Error("Division does not belong to this league");
  const [standings,roundPage]=division?await Promise.all([getCompetitionStandings(token,division.id,signal),listCompetitionRounds(token,leagueId,division.id,signal)]):[[],{entries:[],next_cursor:null}];
  const ownPlayers=[...new Set(submissions.map(s=>s.player?.id).filter((id):id is string=>!!id))];
  return {league:{...league,url:leagueURL(league.id)},division:division??null,divisions,standings,ownPlayers,rounds:roundPage.entries,hasMoreRounds:!!roundPage.next_cursor,checkedAt:new Date().toISOString()};
}
export type LeagueOverview=Awaited<ReturnType<typeof readLeagueOverview>>;
