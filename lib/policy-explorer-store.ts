import {z} from 'zod';
import {policyVersionBySoftmaxId} from './db';
import {defaultLeagueId} from './league-catalog';
import {apiJSON,currentRelease,episodeArtifact,sourceForHash} from './campaigns/provider';
import {readPolicyRepresentation,savePolicyRepresentation} from './policy-representation-store';
import {savedUploadedSource,saveUploadedSource} from './policy-source-store';
import {sourceDigest} from './policy-source-model';
import {explainPolicy} from './policy-explorer';

const digest=z.string().regex(/^[0-9a-f]{64}$/);
const cache=new Map<string,{at:number;data:Promise<string>}>();
type Identity={subjectId:string;token:string};
export class PolicySourceUnavailable extends Error {
 readonly sourceHash?:string;
 constructor(message:string,sourceHash?:string){super(message);this.sourceHash=sourceHash;}
}
async function hostedHash(student:Identity,policyId:string){
 const meta=await apiJSON(student.token,`/stats/policy-versions/${policyId}`);
 let hash=digest.safeParse(meta.player_file_content_hash);
 if(!hash.success){
  const page=await apiJSON(student.token,`/v2/policy-versions/${policyId}/episode-requests?limit=10`);
  for(const episode of (page.entries??[]).filter((e:any)=>e.status==='completed'&&Array.isArray(e.policy_version_ids)&&e.policy_version_ids.includes(policyId)).slice(0,3)){
   const spec=await episodeArtifact(student.token,episode.id,'spec');
   hash=digest.safeParse(spec.players?.[episode.policy_version_ids.indexOf(policyId)]?.content_hash);if(hash.success)break;
  }
 }
 if(!hash.success)throw new PolicySourceUnavailable('The platform has not exposed this policy’s source identity yet. Retry after its first completed game, or open a policy uploaded through this IDE.');
 return hash.data;
}
export async function importPolicySource(student:Identity,policyId:string,source:string){
 if(!source.trim()||Buffer.byteLength(source)>65536)throw Error('Choose a BASIC source file under 64 KiB.');
 const hash=await hostedHash(student,policyId);
 if(sourceDigest(source)!==hash)throw Error('This file does not match the selected policy’s recorded source hash. Choose the original uploaded BASIC file.');
 await saveUploadedSource(student.subjectId,policyId,source);
 return policyExplanation(student,policyId,defaultLeagueId,true);
}
async function sourceForPolicy(student:Identity,policyId:string,league:string){
 const local=await policyVersionBySoftmaxId(student.subjectId,policyId);
 if(local)return {source:local.source,metadata:{policyId,origin:'saved' as const,revision:local.revision_number,summary:local.summary,ir:local.ir}};
 const saved=await savedUploadedSource(student.subjectId,policyId);
 if(saved)return {source:saved,metadata:{policyId,origin:'saved' as const}};
 const key=`${student.subjectId}:${league}:${policyId}`;let entry=cache.get(key);
 if(!entry||Date.now()-entry.at>300000){
  const data=(async()=>{
   const sourceHash=await hostedHash(student,policyId);
   const release=await currentRelease(student.token,league);
   try{const source=await sourceForHash(student.token,release.coworldId,sourceHash,student.subjectId);
    await saveUploadedSource(student.subjectId,policyId,source);return source;
   }catch{throw new PolicySourceUnavailable('The source for this uploaded policy is not saved in this workspace. Import its original BASIC file below; its hash will be checked before editing.',sourceHash);}

  })();
  entry={at:Date.now(),data};if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(key,entry);
  data.catch(()=>{if(cache.get(key)?.data===data)cache.delete(key);});
 }
 return {source:await entry.data,metadata:{policyId,origin:'hosted' as const}};
}
export async function policyExplanation(student:Identity,policyId:string,league=defaultLeagueId,generate=false){
 const {source,metadata}=await sourceForPolicy(student,policyId,league);
 const initial=explainPolicy(source,metadata);
 if(!generate&&initial.representation?.status==='ready')return initial;
 const saved=await readPolicyRepresentation(student.subjectId,league,initial.hash);
 if(saved)return explainPolicy(source,{...metadata,model:saved});
 if(!generate)return initial;
 const model=await savePolicyRepresentation(student.subjectId,source,league);
 // Immutable, hash-addressed and deduplicated. Does not rewrite policy bytes, revision IDs or authored intent.
 return explainPolicy(source,{...metadata,model});
}
