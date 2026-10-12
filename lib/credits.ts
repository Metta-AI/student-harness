import {db} from './db';
export class CreditLimitError extends Error {
 readonly status=402;
 constructor(){super('Not enough daily credits for this operation. Check the credit balance in the navbar; your allowance resets at midnight Pacific.');}
}
export async function reserveCredits(studentId:string,key:string,holdUsd=1){
 const {data,error}=await db().rpc('research_daily_reserve',{p_student:studentId,p_key:key,p_hold:holdUsd});
 if(error)throw Error('Could not check your credits. No new paid operation was started.');
 if(data!==true)throw new CreditLimitError();
}
export type ModelUsage={costUsd?:number;inputTokens?:number;outputTokens?:number;cacheReadTokens?:number;cacheWriteTokens?:number};
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
export async function recordModelUsage(studentId:string,key:string,usage:ModelUsage){
 const input=count(usage.inputTokens),read=count(usage.cacheReadTokens),write=count(usage.cacheWriteTokens);
 const {error}=await db().rpc('user_credit_model_usage',{p_student:studentId,p_key:key,p_input:input,p_output:count(usage.outputTokens),
  p_read:input!==null&&read!==null&&read>input?null:read,p_write:input!==null&&write!==null&&write>input?null:write});
 if(error)throw Error('Could not record model usage. Cache reporting may be incomplete.');
}
export async function settleCredits(studentId:string,key:string,usage:ModelUsage){
 const {error}=await db().rpc('research_daily_settle',{p_student:studentId,p_key:key,p_cost:usage.costUsd??null});
 if(error)throw Error('Could not record credit usage. The reservation remains held.');
 await recordModelUsage(studentId,key,usage);
}
