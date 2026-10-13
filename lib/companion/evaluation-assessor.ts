import {createHash} from 'node:crypto';
import {generateText,Output,type LanguageModel} from 'ai';
import {assessmentInstructions,assessmentSchema,prepareAssessment,validateAssessment} from './evaluation-case';
export async function assessEvaluationCase(input:unknown,options:{targetRef?:string;model?:LanguageModel;allowProviderUpload?:boolean;signal?:AbortSignal}={}){
 const prepared=prepareAssessment(input,options.targetRef),caseDigest=createHash('sha256').update(JSON.stringify(prepared.data)).digest('hex');
 const base={schema:'preston-evaluation-assessment/1',caseDigest,targetRef:prepared.target?.ref??null,
  assessorContract:'preston-trace-review/1',promptDigest:createHash('sha256').update(assessmentInstructions).digest('hex'),scope:'Selected trace review only; not a production agent replay or an independently verified grade.',trainingAuthorized:false};
 if(!prepared.ready)return {...base,status:'not_assessable',reasons:prepared.reasons};
 if(!options.model||!options.allowProviderUpload)return {...base,status:'ready_for_review',reasons:['No data was sent to a model. Explicit per-run provider-upload permission is required.']};
 const prompt=JSON.stringify({targetRef:prepared.target!.ref,expectedBehavior:prepared.data.review.expectedBehavior,trace:prepared.data.trace});
 if(prompt.length>100000)throw Error('The selected trace is too large for a bounded assessment');
 let result;
 try{result=await generateText({model:options.model,system:assessmentInstructions,prompt,output:Output.object({schema:assessmentSchema}),maxOutputTokens:2400,maxRetries:0,abortSignal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000)});
 }catch{return {...base,status:'assessment_failed',reason:'No assessment was accepted. The provider call failed, timed out, or returned unusable structured output. Its cost is unknown; no automatic retry was made.',usage:{inputTokens:null,outputTokens:null,reportedCostUsd:null},providerUploadAuthorized:true};}
 const rawCost=result.providerMetadata?.gateway?.cost;
 const cost=rawCost!==undefined&&rawCost!==null&&rawCost!==''?Number(rawCost):NaN;
 const usage={inputTokens:result.usage.inputTokens??null,outputTokens:result.usage.outputTokens??null,reportedCostUsd:Number.isFinite(cost)&&cost>=0?cost:null};
 try{return {...base,...validateAssessment(prepared.data,prepared.target!.ref,result.output),usage,providerUploadAuthorized:true};}
 catch{return {...base,status:'invalid_assessment',reason:'The generated assessment failed exact-citation or criterion validation. No judgment was accepted.',unvalidatedAssessment:result.output,usage,providerUploadAuthorized:true};}
}
