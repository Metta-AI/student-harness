import {createHash} from 'node:crypto';
import {z} from 'zod';
import {getCatalogLeague,SoftmaxError} from './softmax';
import {leagueIdSchema} from './league-catalog';
import {gameContractReadSchema,manifestHashSchema,type GameContract} from './game-contract-model';

const coworldIdSchema=z.string().regex(/^cow_[0-9a-f-]{36}$/);
const contentSchema=z.object({type:z.string(),value:z.string()});
const runnableSchema=z.object({image:z.string().optional(),file:z.string().optional(),run:z.array(z.string()).default([]),source_url:z.string().nullable().optional()});
const manifestSchema=z.object({
 id:coworldIdSchema,version:z.string(),manifest_hash:manifestHashSchema,
 manifest:z.object({
  game:z.object({name:z.string(),version:z.string(),player_runtime:z.string().optional(),runnable:runnableSchema,
   protocols:z.record(z.string(),contentSchema).default({}),
   docs:z.object({readme:contentSchema.optional(),pages:z.array(z.object({id:z.string(),title:z.string(),content:contentSchema})).default([])}).default({pages:[]}),
   config_schema:z.record(z.string(),z.unknown()).optional(),results_schema:z.record(z.string(),z.unknown()).optional(),
  }),player:z.array(runnableSchema.extend({id:z.string(),name:z.string().optional()})).default([]),
  episode_timeout_minutes:z.number().optional(),players_per_user:z.number().optional(),
  variants:z.array(z.object({id:z.string().min(1).max(180),name:z.string(),game_config:z.record(z.string(),z.unknown())})).max(100).optional(),
 }),
});
export class GameContractUnavailable extends Error {}
export class GameContractChanged extends Error {}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function httpsURL(value:string|undefined|null){try{const url=new URL(value??'');return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}}
function sourceRevision(value:string|null){if(!value)return null;const url=new URL(value);return url.hostname==='github.com'?url.pathname.match(/^\/[^/]+\/[^/]+\/(?:tree|blob)\/([0-9a-f]{40})(?:\/|$)/)?.[1]??null:null;}
/** Only the catalog-derived coworld endpoint is fetched. Documents and source URLs are never fetched here. */
async function readManifest(token:string,id:string,signal:AbortSignal){
 const base=process.env.SOFTMAX_API_URL??'https://softmax.com/api';
 const response=await fetch(`${base}/observatory/v2/coworlds/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${token}`,'User-Agent':'softmax-student-harness/1.0'},cache:'no-store',redirect:'error',signal});
 if(!response.ok){await response.body?.cancel();throw new SoftmaxError(response.status,'coworld contract','Contract unavailable');}
 const maximum=2_000_000;if(Number(response.headers.get('content-length'))>maximum){await response.body?.cancel();throw new GameContractUnavailable('The game manifest exceeds the supported size.');}
 const reader=response.body?.getReader();if(!reader)throw new GameContractUnavailable('The game manifest is empty.');
 const chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>maximum)throw new GameContractUnavailable('The game manifest exceeds the supported size.');chunks.push(part.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return manifestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
export async function readGameContract(token:string,leagueId:string,input:unknown={},signal=AbortSignal.timeout(15000)):Promise<GameContract>{
 leagueIdSchema.parse(leagueId);const p=gameContractReadSchema.parse(input);
 const league=await getCatalogLeague(token,leagueId,signal);
 if(league.id!==leagueId)throw new GameContractUnavailable('The catalog returned another league.');
 const id=coworldIdSchema.safeParse(league.game.coworld_id);if(!id.success)throw new GameContractUnavailable('This league has no published game manifest.');
 const record=await readManifest(token,id.data,signal),game=record.manifest.game;
 if(record.id!==id.data||game.version!==record.version)throw new GameContractUnavailable('The published game identity is inconsistent.');
 if(p.expectedManifestHash&&p.expectedManifestHash!==record.manifest_hash)throw new GameContractChanged('The published game changed. Reload its contract before continuing.');
 const docs=new Map<string,{id:string;title:string;content:string|null;url:string|null;sha256:string|null}>();
 const add=(id:string,title:string,content:z.infer<typeof contentSchema>)=>{
  if(docs.has(id))throw new GameContractUnavailable('The game manifest contains duplicate document IDs.');
  // Embedded text is versioned evidence. Remote documents remain links; no untrusted network hop or credential forwarding.
  const text=content.type==='text'?content.value:null,url=content.type==='url'?httpsURL(content.value):null;
  docs.set(id,{id,title,content:text,url,sha256:text===null?null:hash(text)});
 };
 if(game.docs.readme)add('readme','Overview',game.docs.readme);
 for(const [name,content] of Object.entries(game.protocols))add(`protocol:${name}`,`${name[0]?.toUpperCase()??''}${name.slice(1)} protocol`,content);
 for(const page of game.docs.pages)add(`page:${page.id}`,page.title,page.content);
 if(game.config_schema)add('schema:configuration','Configuration schema',{type:'text',value:JSON.stringify(game.config_schema,null,2)});
 if(game.results_schema)add('schema:results','Results schema',{type:'text',value:JSON.stringify(game.results_schema,null,2)});
 const selected=p.documentId?docs.get(p.documentId):null;if(p.documentId&&!selected)throw new GameContractUnavailable('This document is not in the published game manifest.');
 if(selected&&p.offset>(selected.content?.length??0))throw new GameContractUnavailable('The requested document offset is out of range.');
 const next=selected?.content!==null&&selected?.content!==undefined?Math.min(p.offset+p.limit,selected.content.length):null;
 const sourceURL=httpsURL(game.runnable.source_url),runtime=game.player_runtime??'platform-hosted';
 return {leagueId,leagueName:league.name,gameName:game.name,coworldId:record.id,version:record.version,manifestHash:record.manifest_hash,checkedAt:new Date().toISOString(),
  runtime:runtime==='platform-hosted'||runtime==='game-hosted'?runtime:null,runtimeDefaulted:game.player_runtime===undefined,
  sourceURL,sourceRevision:sourceRevision(sourceURL),episodeTimeoutMinutes:record.manifest.episode_timeout_minutes??null,playersPerUser:record.manifest.players_per_user??null,
  ...(game.config_schema&&record.manifest.variants?{practice:{configSchema:game.config_schema,variants:record.manifest.variants.map(v=>({id:v.id,name:v.name,gameConfig:v.game_config}))}}:{}),
  starters:record.manifest.player.map(s=>{const url=httpsURL(s.source_url);return {id:s.id,name:s.name??s.id,image:s.image??null,file:s.file??null,run:s.run,sourceURL:url,sourceRevision:sourceRevision(url)};}),
  documents:[...docs.values()].map(({content,...d})=>({...d,characters:content?.length??null})),
  document:selected?{id:selected.id,title:selected.title,sha256:selected.sha256,url:selected.url,content:selected.content===null?null:selected.content.slice(p.offset,next!),offset:p.offset,nextOffset:next!==null&&next<selected.content!.length?next:null,totalCharacters:selected.content?.length??null}:null,
 };
}
