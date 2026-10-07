import {randomUUID} from 'node:crypto';
import { markObserved } from '../campaigns/evidence';
import { db } from '../db';
import { defaultLeagueId } from '../league-catalog';
import { readLeagueOverview } from '../league-overview';
import { getPolicyLeaderboard, listPolicyVersionEpisodeRequests, getEpisodeResults, getEpisodeRequest } from '../softmax';
import { opponentToolSchema, type OpponentProfile, type OpponentSnapshot, type OpponentNotebook } from './model';
import { opponentResearchStatus } from './research-status';

export async function opponentRoster(student:string,token:string,leagueId=defaultLeagueId){
  const [league, research]=await Promise.all([readLeagueOverview(token,leagueId),opponentResearchStatus(student,leagueId)]);
  const policies=league.division?await getPolicyLeaderboard(token,league.division.id,AbortSignal.timeout(12000)):[];
  const {data,error}=await db().from('opponent_snapshots').select('policy_id,collected_at,profile:document->profile').eq('student_id',student).eq('league_id',leagueId).order('collected_at',{ascending:false}).limit(500);
  if(error)throw Error('Opponent records could not be loaded');
  const profiles:OpponentProfile[]=(policies??[]).map(p=>{
    const standing=league.standings.find(s=>s.player_id===p.player_id);
    return {current:standing?.policy_label?standing.policy_label===p.policy_label:undefined,policyId:p.policy_version_id,policyLabel:p.policy_label,playerId:p.player_id,playerName:p.player_name,rank:standing?.rank??null,rating:standing?.score??null,ratingLabel:standing?.score_label??null,episodes:p.episodes_played,own:!!p.player_id&&league.ownPlayers.includes(p.player_id)};
  }).sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity)||a.policyLabel.localeCompare(b.policyLabel));
  return {profiles,tracked:data??[],research,checkedAt:league.checkedAt,leagueURL:league.league.url,rounds:league.rounds};
}
export async function readOpponent(student:string,policyId:string,leagueId=defaultLeagueId):Promise<OpponentNotebook>{
  const [snapshots,notes,models,sessions,tasks]=await Promise.all([
    db().from('opponent_snapshots').select('id,collected_at,document').eq('student_id',student).eq('league_id',leagueId).eq('policy_id',policyId).order('collected_at',{ascending:false}).limit(20),
    db().from('opponent_notes').select('id,actor,kind,text,evidence,created_at').eq('student_id',student).eq('league_id',leagueId).eq('policy_id',policyId).order('created_at',{ascending:false}).limit(100),
    db().from('opponent_models').select('id,created_at,actor,document').eq('student_id',student).eq('league_id',leagueId).eq('policy_id',policyId).order('created_at',{ascending:false}).limit(20),
    db().from('chat_sessions').select('session_id,title,updated_at').eq('student_id',student).eq('opponent_league_id',leagueId).eq('opponent_policy_id',policyId).is('archived_at',null).order('updated_at',{ascending:false}).limit(30),
    db().from('agent_tasks').select('id,objective,status,context').eq('student_id',student).eq('kind','research').eq('context->>policyId',policyId).eq('context->>leagueId',leagueId).order('created_at',{ascending:false}).limit(30),
  ]);
  if(snapshots.error||notes.error||models.error||sessions.error||tasks.error)throw Error('Opponent notebook unavailable');
  return {snapshots:snapshots.data,notes:notes.data,models:models.data,sessions:sessions.data,tasks:tasks.data};
}
export async function collectOpponent(student:string,token:string,policyId:string,leagueId=defaultLeagueId,episodeIds?:string[]){
  const roster=await opponentRoster(student,token,leagueId);
  const profile=roster.profiles.find(p=>p.policyId===policyId);
  if(!profile)throw Error('Policy is not in the current league policy results');
  let warning:string|undefined;
  const rejectedEpisodes:{id:string;reason:string}[]=[];
  const specific=episodeIds?(await Promise.all([...new Set(episodeIds)].map(async id=>{
    const e=await getEpisodeRequest(token,id);
    const reason=!e.policy_version_ids.includes(policyId)?'different policy version':!e.round_id?'no league round recorded':!roster.rounds.some(r=>r.id===e.round_id)?'outside the sampled league rounds':null;
    if(reason){rejectedEpisodes.push({id,reason});return null;}
    return {...e,created_at:e.created_at??''};
  }))).filter(e=>e!==null):null;
  if(specific&&!specific.length)throw Error(`Episodes are outside verified league/policy evidence: ${rejectedEpisodes.map(e=>`${e.id}: ${e.reason}`).join('; ')}. Collect without episodeIds for the available league sample. Keep unverified episodes separate.`);
  if(rejectedEpisodes.length)warning=`Excluded ${rejectedEpisodes.length} unverified episode(s); only the listed episodes are evidence.`;
  const page=specific?{entries:specific,next_cursor:null}:await listPolicyVersionEpisodeRequests(token,policyId,null,50,AbortSignal.timeout(15000)).catch(()=>{
    warning='Softmax could not provide this policy’s episode history. Only the standings snapshot was collected. Collect again to retry.';
    return {entries:[],next_cursor:null};
  });
  const rounds=new Map(roster.rounds.map(r=>[r.id,r.round_number]));
  const entries=page.entries.filter(e=>e.round_id&&rounds.has(e.round_id));
  await Promise.all(entries.map(e=>markObserved(student,leagueId,e.id,'Opponent evidence collection')));
  const results=new Map((await getEpisodeResults(token,entries.map(e=>e.id),AbortSignal.timeout(15000)).catch(()=>{
    warning='Episode references were collected, but Softmax could not provide their scores or participants. Collect again to retry.';return [];
  })).map(e=>[e.id,e]));
  const document:OpponentSnapshot={profile,collectedAt:new Date().toISOString(),source:roster.leagueURL,
    coverage:specific?'Selected episode evidence, verified against this policy version and the latest 25 rounds in this league division. Not a complete match history.':'Up to 50 recent policy episodes, restricted to the latest 25 rounds in this league division. This is a sample, not a complete match history.',hasMore:!!page.next_cursor,
    warning,episodes:entries.map(e=>{const r=results.get(e.id);const participants=r?.participants??[];const positions=new Set(participants.filter(p=>p.policy_version_id===policyId).map(p=>p.position));return {id:e.id,status:e.status,round:rounds.get(e.round_id!)!,createdAt:e.created_at,replay:!!e.replay_url,participants,scores:(r?.participant_scores??[]).filter(s=>positions.has(s.position))};})};
  const snapshotId=randomUUID();
  const {error}=await db().from('opponent_snapshots').insert({id:snapshotId,student_id:student,league_id:leagueId,policy_id:policyId,document});
  if(error)throw Error('Could not save opponent snapshot');
  return {...document,snapshotId,rejectedEpisodes};
}
export async function opponentResearch(student:string,token:string,input:unknown,actor:'human'|'preston',leagueId=defaultLeagueId){
  const args=opponentToolSchema.parse(input);
  if(args.action==='list')return opponentRoster(student,token,leagueId);
  if(args.action==='read')return readOpponent(student,args.policyId!,leagueId);
  if(args.action==='collect')return collectOpponent(student,token,args.policyId!,leagueId,args.episodeIds);
  if(args.action==='save_model'){
    // Resolve each cited snapshot independently; older evidence remains valid beyond the notebook's display limit.
    const ids=[...new Set(args.model!.evidence.map(e=>e.snapshotId))];
    const {data,error}=await db().from('opponent_snapshots').select('id,document').eq('student_id',student).eq('league_id',leagueId).eq('policy_id',args.policyId!).in('id',ids);
    if(error)throw Error('Could not verify model evidence');
    for(const evidence of args.model!.evidence){
      const snapshot=data?.find(s=>s.id===evidence.snapshotId);
      if(!snapshot || (evidence.episodeId && !(snapshot.document as OpponentSnapshot).episodes.some(e=>e.id===evidence.episodeId)))throw Error(`Model evidence ${evidence.id} is invalid: ${snapshot?`episode ${evidence.episodeId} is not in snapshot ${evidence.snapshotId}. Available episodes: ${(snapshot.document as OpponentSnapshot).episodes.map(e=>e.id).join(', ')}`:`snapshot ${evidence.snapshotId} is not available for this account, league and exact policy version`}. Use the snapshotId returned by collect and only its listed episodes.`);
    }
    const saved=await db().from('opponent_models').insert({student_id:student,league_id:leagueId,policy_id:args.policyId!,actor,document:args.model!});
    if(saved.error)throw Error('Could not save semantic model');
    return {saved:true};
  }
  const book=await readOpponent(student,args.policyId!,leagueId);
  if(!book.snapshots.length)throw Error('Collect this policy first so the note has a policy record');
  const {error}=await db().from('opponent_notes').insert({student_id:student,league_id:leagueId,policy_id:args.policyId!,actor,...args.note!});
  if(error)throw Error('Could not save opponent note');
  return {saved:true};
}
