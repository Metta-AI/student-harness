export type LeagueEntry = {
  policyVersionId: string; playerId?: string; playerName?: string; policyLabel?: string;
  status?: string; active?: boolean; createdAt?: string;
};
type Submission = {status:string;created_at?:string;policy_version?:{id:string;label?:string;policy?:{name:string};version?:number};player?:{id:string;name?:string}|null};
export type LeagueMembership = {status:string;substatus:string|null;is_champion:boolean;start_time:string;end_time:string|null;division?:{id:string}|null;policy_version:{id:string;label?:string;policy?:{name:string};version?:number};player:{id:string;name?:string}|null};
const label=(version:NonNullable<Submission['policy_version']>)=>version.label??(version.policy?.name&&version.version!==undefined?`${version.policy.name}:v${version.version}`:undefined);
export function leaguePolicyEntries(submissions:Submission[],memberships:LeagueMembership[],divisionId:string){
 const ownPlayers=new Set(submissions.flatMap(s=>s.player?[s.player.id]:[]));
 const ownVersions=new Set(submissions.flatMap(s=>s.policy_version?[s.policy_version.id]:[]));
 const champions=memberships.filter(m=>m.division?.id===divisionId && m.status==='competing' && m.substatus==='active' && m.is_champion && !m.end_time).sort((a,b)=>b.start_time.localeCompare(a.start_time));
 const ours=memberships.filter(m=>ownVersions.has(m.policy_version.id)||(!!m.player&&ownPlayers.has(m.player.id)));
 const active=champions.filter(m=>ours.includes(m));
 const entries:LeagueEntry[]=submissions.filter(s=>s.policy_version).map(s=>{
  const m=ours.find(m=>m.policy_version.id===s.policy_version!.id&&m.division?.id===divisionId);
  return {policyVersionId:s.policy_version!.id,playerId:s.player?.id,playerName:s.player?.name,policyLabel:label(s.policy_version!),status:m?(m.end_time?'inactive':m.substatus??m.status):s.status,active:active.some(m=>m.policy_version.id===s.policy_version!.id),createdAt:s.created_at};
 });
 for(const m of ours)if(!entries.some(e=>e.policyVersionId===m.policy_version.id))entries.push({policyVersionId:m.policy_version.id,playerId:m.player?.id,playerName:m.player?.name,policyLabel:label(m.policy_version),status:m.end_time?'inactive':m.substatus??m.status,active:active.includes(m),createdAt:m.start_time});
 return {entries,entered:active.map(m=>m.policy_version.id),currentPolicyId:active[0]?.policy_version.id??null,champions};
}
export function selectPerformancePolicy(selected:string,current:string|null|undefined,loaded:boolean,fallback:string){
 // Never label a local draft/upload as the current league policy while remote membership is loading.
 return selected || (loaded ? current || fallback : '');
}
