import {createHash} from 'node:crypto';
import {z} from 'zod';
import {readGameContract,GameContractUnavailable} from '../game-contract';
import {manifestHashSchema,type GameContract} from '../game-contract-model';
import {leagueIdSchema} from '../league-catalog';

const inputSchema=z.strictObject({policyVersionId:z.uuid(),variantId:z.string().min(1).max(180),idempotencyKey:z.string().min(5).max(200).regex(/^[^\x00]*$/)});
const planSchema=z.strictObject({leagueId:leagueIdSchema,coworldId:z.string().regex(/^cow_[0-9a-f-]{36}$/),manifestHash:manifestHashSchema,gameVersion:z.string().min(1).max(128),variantId:inputSchema.shape.variantId,policyVersionId:z.uuid(),seatCount:z.number().int().min(1).max(32),episodeTimeoutSeconds:z.number().int().min(1).max(10800),gameConfig:z.record(z.string(),z.unknown()),idempotencyKey:inputSchema.shape.idempotencyKey,requestBody:z.string().max(131072),requestSha256:z.string().regex(/^[a-f0-9]{64}$/)});
export type PracticePlan=z.infer<typeof planSchema>;
export type PracticePlanInput=z.infer<typeof inputSchema>;
export const practiceBodyHash=(body:string)=>createHash('sha256').update(body).digest('hex');
/** Deterministic JSON with no prototype keys, non-JSON values or oversized graphs. */
export function canonicalPracticeJSON(value:unknown):string{
 let nodes=0;
 const sorted=(v:unknown,depth=0):unknown=>{
  if(++nodes>10000||depth>30)throw new Error('Practice configuration exceeds supported bounds');
  if(v===null||typeof v==='boolean'||typeof v==='string')return v;
  if(typeof v==='number'&&Number.isFinite(v))return v;
  if(Array.isArray(v))return v.map(x=>sorted(x,depth+1));
  if(v&&typeof v==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(v))){const result:Record<string,unknown>={};for(const k of Object.keys(v).sort()){if(['__proto__','constructor','prototype'].includes(k))throw Error('Unsupported practice configuration key');result[k]=sorted((v as Record<string,unknown>)[k],depth+1);}return result;}
  throw Error('Practice configuration must contain JSON values');
 };
 const body=JSON.stringify(sorted(value));if(Buffer.byteLength(body)>131072)throw Error('Practice configuration exceeds supported bounds');return body;
}
function requestFor(p:Omit<PracticePlan,'requestBody'|'requestSha256'>){return {idempotency_key:p.idempotencyKey,private:true,target:{coworld_id:p.coworldId,variant_id:p.variantId},game_config_overrides:p.gameConfig,roster:Array.from({length:p.seatCount},(_,slot)=>({player:{policy_ref:p.policyVersionId},slot})),num_episodes:1,episode_player_llm_spend_limit_usd:0,title:'Single hosted policy practice',reporters:[]};}
const object=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
/** Support only independently explicit, agreeing seat counts. Never infer from players_per_user. */
export function practiceSeatCount(schema:Record<string,unknown>,config:Record<string,unknown>):number{
 const properties=object(schema.properties);if(!properties)throw new GameContractUnavailable('The published game has no supported seat contract');
 const counts:number[]=[];
 for(const key of ['tokens','players','agent_names']){
  const field=object(properties[key]);if(!field)continue;
  if(field.type==='array'&&Number.isInteger(field.minItems)&&field.minItems===field.maxItems)counts.push(field.minItems as number);
  else if(Array.isArray(config[key]))counts.push((config[key] as unknown[]).length);
 }
 const agents=object(properties.num_agents);if(agents){if(Number.isInteger(agents.const))counts.push(agents.const as number);if(Number.isInteger(config.num_agents))counts.push(config.num_agents as number);}
 if(!counts.length||counts.some(n=>n!==counts[0]||n<1||n>32))throw new GameContractUnavailable('The published seat contract is missing, ambiguous or unsupported');
 return counts[0];
}
/** Mirror the hosted XP API's runtime-owned roster labels; preserve authored seat options. */
function namedPracticeConfig(schema:Record<string,unknown>,config:Record<string,unknown>,seats:number){
 if(Object.hasOwn(config,'player_names'))throw new GameContractUnavailable('The published game uses unsupported legacy player names');
 const players=object(object(schema.properties)?.players),items=object(players?.items),name=object(object(items?.properties)?.name);
 if(players?.type!=='array'||items?.type!=='object'||name?.type!=='string')return config;
 const existing=config.players;
 if(existing!==undefined&&existing!==null&&(!Array.isArray(existing)||existing.some(p=>!object(p))))throw new GameContractUnavailable('The published game has unsupported named player configuration');
 const originals=Array.isArray(existing)?existing:[];
 return {...config,players:Array.from({length:seats},(_,i)=>({...originals[i%originals.length],name:`Player ${i+1}`}))};
}
export function buildPracticePlan(contract:GameContract,input:PracticePlanInput):PracticePlan{
 const p=inputSchema.parse(input),metadata=contract.practice;
 if(contract.runtime!=='platform-hosted'||!metadata)throw new GameContractUnavailable('This release has no supported container practice contract');
 const variants=metadata.variants.filter(v=>v.id===p.variantId);if(variants.length!==1)throw new GameContractUnavailable('Choose one unambiguous published variant');
 const timeout=(contract.episodeTimeoutMinutes??0)*60;if(!Number.isInteger(timeout)||timeout<1||timeout>10800)throw new GameContractUnavailable('The published episode timeout is missing or exceeds three hours');
 let config=JSON.parse(canonicalPracticeJSON(variants[0].gameConfig));
 // Runtime owns authentication tokens and state; a practice plan never forwards either from authored configuration.
 if(['tokens','coworld_state'].some(k=>Object.hasOwn(config,k))||canonicalPracticeJSON(config).includes('secret://'))throw new GameContractUnavailable('Published practice configuration requires unsupported runtime state or secrets');
 const seatCount=practiceSeatCount(metadata.configSchema,config);config=namedPracticeConfig(metadata.configSchema,config,seatCount);
 const base={leagueId:contract.leagueId,coworldId:contract.coworldId,manifestHash:contract.manifestHash,gameVersion:contract.version,variantId:p.variantId,policyVersionId:p.policyVersionId,seatCount,episodeTimeoutSeconds:timeout,gameConfig:config,idempotencyKey:p.idempotencyKey};
 const requestBody=canonicalPracticeJSON(requestFor(base));return validatePracticePlan({...base,requestBody,requestSha256:practiceBodyHash(requestBody)});
}
export function validatePracticePlan(value:unknown):PracticePlan{
 const p=planSchema.parse(value);
 if(p.requestSha256!==practiceBodyHash(p.requestBody)||p.requestBody!==canonicalPracticeJSON(requestFor(p)))throw Error('Saved practice request identity does not match its plan');
 return p;
}
/** Read-only current league/release check. The subsequent POST pins the exact Coworld ID. */
export async function readPracticePlan(token:string,leagueId:string,input:PracticePlanInput&{expectedManifestHash:string},signal?:AbortSignal){
 const {expectedManifestHash,...p}=input;manifestHashSchema.parse(expectedManifestHash);inputSchema.parse(p);
 return buildPracticePlan(await readGameContract(token,leagueId,{expectedManifestHash},signal),p);
}
