import { createHash } from 'node:crypto';
import { z } from 'zod';

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
export const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const hashObject = (value:unknown) => sha(canonical(value));
/** Softmax mirrors the same immutable container between public and execution registries. */
export function releaseFingerprint(manifest: any): string {
  const image = manifest?.game?.runnable?.image;
  const digest = typeof image === 'string' ? image.match(/@sha256:([a-f0-9]{64})$/)?.[1] : undefined;
  if (!digest) return hashObject(manifest);
  return hashObject({...manifest, game: {...manifest.game, runnable: {...manifest.game.runnable, image: `sha256:${digest}`}}});
}
export const protocolSchema = z.object({
  screenPairs: z.number().int().min(2).max(256).default(16),
  confirmationPairs: z.number().int().min(2).max(512).default(64),
  gate: z.enum(['directional','confidence']).default('directional'),
  concurrency: z.number().int().min(1).max(24).default(4),
  promote: z.boolean().default(true), continuous: z.boolean().default(true),
  observeMinutes: z.number().int().min(5).max(1440).default(60),
  fixtureMode:z.enum(['league','fresh-seeds']).default('league'),
});
// New campaigns should not exhaust the small supply of untouched historical
// rounds. Existing persisted protocols retain their declared selection mode.
const newCampaignProtocolSchema=protocolSchema.extend({fixtureMode:z.enum(['league','fresh-seeds']).default('fresh-seeds')});
export const campaignInputSchema = z.object({
  objective:z.string().trim().min(12).max(6000),
  leagueId:z.string().regex(/^league_[a-zA-Z0-9-]+$/),
  playerIds:z.array(z.string().regex(/^ply_[a-zA-Z0-9-]+$/)).max(10).default([]),
  protocol:newCampaignProtocolSchema.default(()=>newCampaignProtocolSchema.parse({})),
  requestKey:z.string().min(8).max(160),
});
export type Protocol=z.infer<typeof protocolSchema>;
export type Baseline={playerId:string;playerName:string;versionId:string;source:string;sourceHash:string};
export type Release={coworldId:string;sourceUrl:string;fingerprint:string};
export type Candidate={source:string;sourceHash:string;baselineHash:string;summary:string;components:Component[];versionId?:string};
export {componentSchema,candidateProposalSchema} from './candidate-schema';
export type {Component} from './candidate-schema';
import {candidateProposalSchema,type Component} from './candidate-schema';
export function constructCandidate(baseline:Baseline, proposal:z.infer<typeof candidateProposalSchema>, knownEvidence:Set<string>):Candidate {
  let source=baseline.source;
  const spans:{start:number;end:number;after:string}[]=[];
  const ids=new Set<string>();
  for(const c of proposal.components){
    if(ids.has(c.id))throw Error('Duplicate component ID');ids.add(c.id);
    if(c.evidence.some(e=>!knownEvidence.has(e)))throw Error('Candidate cites unknown evidence');
    const start=baseline.source.indexOf(c.before);
    if(start<0||baseline.source.indexOf(c.before,start+1)>=0)throw Error('Component must match exactly one baseline source span');
    const end=start+c.before.length;
    if(spans.some(s=>start<s.end&&end>s.start))throw Error('Components overlap; reconcile them before testing');
    spans.push({start,end,after:c.after});
  }
  for(const s of spans.sort((a,b)=>b.start-a.start))source=source.slice(0,s.start)+s.after+source.slice(s.end);
  if(source===baseline.source)throw Error('Candidate does not change behavior source');
  if(Buffer.byteLength(source)>65536)throw Error('Candidate exceeds the hosted source limit');
  return {source,sourceHash:sha(source),baselineHash:baseline.sourceHash,summary:proposal.summary,components:proposal.components};
}
export type Fixture={episodeId:string;templateEpisodeId?:string;seed:number;slot:number;roster:string[];hashes:string[];config:Record<string,unknown>;release:Release};
export type Outcome={episodeId:string;utility:number;win:boolean;loss:boolean;xp:number;score:number;replayHash:string;audit:'verified';evidence:Record<string,unknown>};
export type OutcomeSummary=Pick<Outcome,'utility'|'win'|'loss'|'xp'|'score'>;
export type StudyProtocol={release:Release;baseline:Baseline;candidate:Candidate;cohort:'screen'|'confirmation';pairs:number;gate:Protocol['gate'];metric:'team-match-utility';selectedEpisodeIds:string[];selectionMode?:Protocol['fixtureMode'];templateEpisodeIds?:string[]};
export type Campaign={id:string;student_id:string;task_id:string;league_id:string;player_ids:string[];objective:string;state:'active'|'paused'|'canceled'|'completed';phase:string;cycle:number;protocol:Protocol;checkpoint:Record<string,any>;lease_token:string;next_at:string};
export type Study={id:string;student_id:string;campaign_id:string;task_id:string;cycle:number;cohort:'screen'|'confirmation';state:string;protocol:StudyProtocol;protocol_hash:string;result:ReturnType<typeof summarize>|null;lease_token:string};

/** Fixed-seed paired bootstrap, so retries and reviews return identical statistics. */
export function summarize(pairs:{baseline:OutcomeSummary;candidate:OutcomeSummary}[],expected:number,gate:Protocol['gate']){
  if(pairs.length!==expected||!pairs.length)throw Error('Finish every frozen pair before evaluating');
  const deltas=pairs.map(p=>p.candidate.utility-p.baseline.utility);
  const mean=(xs:number[])=>xs.reduce((a,b)=>a+b,0)/xs.length;
  let state=0x51f15e;const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
  const samples=Array.from({length:4000},()=>mean(deltas.map(()=>deltas[Math.floor(random()*deltas.length)]))).sort((a,b)=>a-b);
  const baselineWins=pairs.filter(p=>p.baseline.win).length,candidateWins=pairs.filter(p=>p.candidate.win).length;
  const utilityDelta=mean(deltas),interval=[samples[100],samples[3899]];
  return {pairs:expected,baselineWins,candidateWins,baselineLosses:pairs.filter(p=>p.baseline.loss).length,candidateLosses:pairs.filter(p=>p.candidate.loss).length,
    utilityDelta,interval,xpDelta:mean(pairs.map(p=>p.candidate.xp-p.baseline.xp)),scoreDelta:mean(pairs.map(p=>p.candidate.score-p.baseline.score)),
    improved:deltas.filter(x=>x>0).length,regressed:deltas.filter(x=>x<0).length,
    passed:utilityDelta>0&&candidateWins>baselineWins&&(gate==='directional'||interval[0]>0),
    interpretation:interval[0]>0?'Positive paired utility interval':interval[1]<0?'Negative paired utility interval; candidate regressed':'Uncertainty includes no improvement; directional evidence only'};
}
export function gameRequest(studyId:string,fixtureId:string,fixture:Fixture,arm:'baseline'|'candidate',policyId:string,attempt=0){
  if(fixture.roster.length!==10||fixture.hashes.length!==10||fixture.slot<0||fixture.slot>9||!Number.isInteger(fixture.seed))throw Error('Invalid matched fixture');
  const roster=[...fixture.roster];roster[fixture.slot]=policyId;
  return {idempotency_key:`preston:${studyId}:${fixtureId}:${arm}:${attempt}`,private:true,num_episodes:1,
    target:{coworld_id:fixture.release.coworldId,variant_id:'competition'},game_config_overrides:{...fixture.config,seed:fixture.seed},
    roster:roster.map((version,slot)=>({slot,player:{policy_ref:version}})),title:`Preston ${arm} matched evaluation`,description:'Frozen paired league configuration; all policies react normally.'};
}
