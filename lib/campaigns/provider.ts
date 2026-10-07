import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { hashObject, releaseFingerprint, sha, type Baseline, type Release, type Fixture, type Outcome } from './model';
import { listLeagueMemberships, uploadPolicy } from '../softmax';

const base='https://softmax.com/api/observatory';
export class ProviderError extends Error {status:number;constructor(status:number,path:string){super(`Softmax ${status}: ${path}`);this.status=status;}}
export async function apiBytes(token:string,path:string,body?:unknown){
 if(!path.startsWith('/')||path.startsWith('//'))throw Error('Invalid provider path');
 const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000),cache:'no-store'});
 if(!r.ok)throw new ProviderError(r.status,path);
 const data=Buffer.from(await r.arrayBuffer());if(data.length>64*1024*1024)throw Error('Artifact exceeds 64 MiB');
 return data[0]===31&&data[1]===139?gunzipSync(data,{maxOutputLength:64*1024*1024}):data;
}
export async function apiJSON(token:string,path:string,body?:unknown):Promise<any>{return JSON.parse((await apiBytes(token,path,body)).toString('utf8'));}
export async function currentRelease(token:string,leagueId:string):Promise<Release>{
 const league=await apiJSON(token,`/v2/leagues/${encodeURIComponent(leagueId)}`);
 const coworldId=z.string().regex(/^cow_[a-zA-Z0-9-]+$/).parse(league.game?.canonical_coworld_id);
 const cow=await apiJSON(token,`/v2/coworlds/${coworldId}`);
 const sourceUrl=z.string().url().parse(cow.manifest?.game?.runnable?.source_url);
 return {coworldId,sourceUrl,fingerprint:releaseFingerprint(cow.manifest)};
}
export async function champions(token:string,leagueId:string,playerIds:string[]=[]){
 const [players,members]=await Promise.all([apiJSON(token,'/players'),listLeagueMemberships(token,undefined,leagueId)]);
 const owned=z.array(z.object({id:z.string(),name:z.string(),is_default:z.boolean().optional(),disabled_at:z.string().nullable().optional()})).parse(players).filter(p=>!p.disabled_at);
 if(playerIds.some(id=>!owned.some(p=>p.id===id)))throw Error('Campaign player is not owned by this account');
 const selected=playerIds.length?owned.filter(p=>playerIds.includes(p.id)):owned.filter(p=>p.is_default).slice(0,1);
 const targets=selected.length?selected:owned.slice(0,1);
 return targets.map(player=>{
  const matches=members.filter(m=>m.player?.id===player.id&&m.is_champion&&!m.end_time&&m.status==='competing'&&m.substatus==='active');
  if(matches.length!==1)throw Error(`Expected one active champion for ${player.name}; found ${matches.length}`);
  return {playerId:player.id,playerName:player.name,versionId:matches[0].policy_version.id,membership:matches[0]};
 });
}
export async function policySourceHash(token:string,versionId:string){
 const meta=await apiJSON(token,`/stats/policy-versions/${versionId}`);
 if(meta.player_file_content_hash)return z.string().regex(/^[0-9a-f]{64}$/).parse(meta.player_file_content_hash);
 let cursor:string|undefined;const seen=new Set<string>();
 do{
  const episodes=await apiJSON(token,`/v2/policy-versions/${encodeURIComponent(versionId)}/episode-requests?limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);
  for(const episode of episodes.entries??[]){
   if(episode.status!=='completed'||!Array.isArray(episode.policy_version_ids)||!episode.policy_version_ids.includes(versionId))continue;
   let spec;
   try{spec=await episodeArtifact(token,episode.id,'spec');}
   catch(error){if(error instanceof ProviderError&&error.status===404)continue;throw error;}
   return z.string().regex(/^[0-9a-f]{64}$/).parse(spec.players?.[episode.policy_version_ids.indexOf(versionId)]?.content_hash);
  }
  cursor=episodes.next_cursor??undefined;
  if(cursor){if(seen.has(cursor))throw Error('Champion episode pagination did not advance');seen.add(cursor);}
 }while(cursor);
 throw Error('No source identity is available for this champion yet');
}
export async function sourceForHash(token:string,coworldId:string,sourceHash:string,studentId?:string){
 if(studentId){
  const {db}=await import('../db');
  const saved=await db().from('research_artifacts').select('content').eq('student_id',studentId).in('kind',['policy-source','candidate','baseline']).eq('content->>sourceHash',sourceHash).limit(1);
  const source=saved.data?.[0]?.content?.source;
  if(typeof source==='string'&&sha(source)===sourceHash)return source;
  const local=await db().from('policy_versions').select('source').eq('student_id',studentId).order('created_at',{ascending:false}).limit(100);
  const match=local.data?.find(p=>sha(p.source)===sourceHash);if(match)return match.source as string;
 }
 const bytes=await apiBytes(token,`/v2/coworlds/${coworldId}/player-files/${sourceHash}`).catch(()=>{throw Error(`Champion source ${sourceHash.slice(0,12)} is not available. Import its exact BASIC source into research artifacts.`);});
 if(sha(bytes)!==sourceHash)throw Error('Downloaded source hash mismatch');return bytes.toString('utf8');
}
export async function resolveBaselines(token:string,leagueId:string,playerIds:string[],studentId?:string){
 const release=await currentRelease(token,leagueId), members=await champions(token,leagueId,playerIds);
 const baselines:Baseline[]=[];
 for(const m of members){
  const sourceHash=await policySourceHash(token,m.versionId);
  const source=await sourceForHash(token,release.coworldId,sourceHash,studentId);
  if(Buffer.byteLength(source)>65536)throw Error('Current policy is not a supported BASIC source file');
  baselines.push({playerId:m.playerId,playerName:m.playerName,versionId:m.versionId,sourceHash,source});
 }
 if(!baselines.length)throw Error('No current champion is available');
 // Different champions require separate campaigns and their own comparisons.
 if(baselines.some(b=>b.sourceHash!==baselines[0].sourceHash))throw Error('Selected players have different champions. Start one campaign per baseline.');
 return {release,baselines};
}
export async function episodeArtifact(token:string,id:string,kind:'spec'|'results'|'player-status'|'replay'){
 if(!/^ereq_[a-zA-Z0-9-]+$/.test(id))throw Error('Invalid episode ID');
 const bytes=await apiBytes(token,`/v2/episode-requests/${id}/artifacts/${kind}`);
 return kind==='replay'?bytes:JSON.parse(bytes.toString('utf8'));
}
export async function fixtureInputs(token:string,episode:{id:string;policy_version_ids:string[]},release:Release):Promise<Omit<Fixture,'slot'>>{
 const [spec,result]=await Promise.all([episodeArtifact(token,episode.id,'spec'),episodeArtifact(token,episode.id,'results')]);
 const seed=z.number().int().parse(result.seed);
 if(spec.coworld_id!==release.coworldId||releaseFingerprint(spec.manifest)!==release.fingerprint)throw Error('Fixture belongs to a different game release');
 const roster=z.array(z.string()).length(10).parse(episode.policy_version_ids);
 const hashes=z.array(z.object({content_hash:z.string().regex(/^[0-9a-f]{64}$/)})).length(10).parse(spec.players).map(p=>p.content_hash);
 const {tokens:_tokens,players:_players,...config}=spec.game_config;
 if(config.draft_mode!=='open')throw Error('Matched GoTA adapter requires open draft');
 return {episodeId:episode.id,seed,roster,hashes,config:{...config,seed},release};
}
export async function leagueFixtureMetadata(token:string,leagueId:string){
 const divisions=await apiJSON(token,`/v2/divisions?league_id=${encodeURIComponent(leagueId)}`);
 const division=divisions.find((d:any)=>d.type==='competition');if(!division)throw Error('Competition division unavailable');
 const rounds=await apiJSON(token,`/v2/rounds?league_id=${encodeURIComponent(leagueId)}&division_id=${encodeURIComponent(division.id)}&limit=30`);
 const episodes:{id:string;policy_version_ids:string[]}[]=[];
 // Metadata only: selection precedes result/seed retrieval and model inspection.
 for(const round of rounds.entries){
  let cursor:string|null=null;
  do{
   const page=await apiJSON(token,`/v2/rounds/${encodeURIComponent(round.id)}/episode-requests?limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);
   episodes.push(...page.entries.filter((e:any)=>e.status==='completed'&&e.policy_version_ids?.length===10));cursor=page.next_cursor??null;
  }while(cursor);
  if(episodes.length>=1024)break;
 }
 return [...new Map(episodes.map(e=>[e.id,e])).values()];
}
export {uploadPolicy};

/** Enforce factual parity before interpreting native worker output as evidence. */
export function verifyAudit(f:Fixture,sourceHash:string,episodeId:string,spec:any,result:any,status:any,replay:Uint8Array,native:any):Outcome{
 if(spec.coworld_id!==f.release.coworldId||releaseFingerprint(spec.manifest)!==f.release.fingerprint)throw Error('Game release changed');
 if(result.seed!==f.seed||spec.game_config.seed!==f.seed)throw Error('Seed mismatch');
 const clean=(c:Record<string,unknown>)=>Object.fromEntries(Object.entries(c).filter(([k])=>!['players','tokens'].includes(k)));
 if(hashObject(clean(spec.game_config))!==hashObject(clean(f.config)))throw Error('Game configuration mismatch');
 const hashes=[...f.hashes];hashes[f.slot]=sourceHash;
 if(spec.players?.length!==10||spec.players.some((p:any,i:number)=>p.content_hash!==hashes[i]))throw Error('Policy roster/source mismatch');
 if(status.players?.length!==10||new Set(status.players.map((p:any)=>p.slot)).size!==10||status.players.some((p:any)=>p.exit_code!==0||p.slot<0||p.slot>9))throw Error('Policy VM failed or status missing');
 if(native.release!==f.release.fingerprint||native.replayHash!==sha(replay))throw Error('Audit receipt identity mismatch');
 const sim=native.simulation;
 if(!Number.isInteger(result.ticks)||result.ticks<=0||sim?.hash_mismatches!==0||sim.ticks!==result.ticks||sim.seed!==result.seed)throw Error('Replay audit mismatch');
 if(!['RedTeam','BlueTeam','time_limit'].includes(result.outcome))throw Error(`Unknown GoTA outcome: ${result.outcome}`);
 const winner=result.outcome==='RedTeam'?0:result.outcome==='BlueTeam'?1:-1;
 if(sim.winner!==winner||sim.heroes?.length!==10||result.total_xp?.length!==10||result.scores?.length!==10)throw Error('Replay outcome mismatch');
 if(sim.heroes.some((h:any,i:number)=>h.xp!==result.total_xp[i]))throw Error('XP ledger mismatch');
 if(result.scores.some((score:number,i:number)=>score!==(winner===Math.floor(i/5)?Math.floor(result.total_xp[i]*1440/result.ticks):0)))throw Error('Score ledger mismatch');
 if(native.vm?.validated_hashes!==result.ticks||native.vm?.source_hash!==sourceHash)throw Error('Subject VM re-execution missing or mismatched');
 return {episodeId,utility:winner<0?0.5:Number(winner===Math.floor(f.slot/5)),win:winner===Math.floor(f.slot/5),loss:winner>=0&&winner!==Math.floor(f.slot/5),xp:result.total_xp[f.slot],score:result.scores[f.slot],replayHash:sha(replay),audit:'verified',evidence:{ticks:result.ticks,slot:f.slot,release:f.release,hashes,native}};
}
