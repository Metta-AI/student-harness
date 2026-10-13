import {db} from './db';
import {artifact} from './campaigns/store';
import {defaultLeagueId} from './league-catalog';
import {describePolicySource,policySourceModelSchema,type PolicySourceModel} from './policy-source-model';
const kind='policy-source-semantics';
export async function readPolicyRepresentation(studentId:string,league:string,hash:string):Promise<PolicySourceModel|undefined>{
 const result=await db().from('research_artifacts').select('content').eq('student_id',studentId).eq('league_id',league).eq('kind',kind)
  .eq('content->>sourceHash',hash).order('created_at',{ascending:false}).limit(1).maybeSingle();
 if(result.error)throw Error('Saved representation could not load.');
 const parsed=policySourceModelSchema.safeParse(result.data?.content?.model);
 return parsed.success&&parsed.data.sourceHash===hash?parsed.data:undefined;
}
export async function savePolicyRepresentation(studentId:string,source:string,league=defaultLeagueId){
 const model=describePolicySource(source);
 await artifact(studentId,league,kind,'Policy semantic representation',{sourceHash:model.sourceHash,model});
 return model;
}
