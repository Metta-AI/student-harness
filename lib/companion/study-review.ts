import {readLearningStudy} from './learning-store';
import {defaultLeagueId} from '../league-catalog';

/** A bounded orientation, with exact-entry reads for the original reasoning. */
export async function studyReviewContext(student:string,studyId:string,before?:number,leagueId=defaultLeagueId){
 const detail=await readLearningStudy(student,studyId,before,leagueId);
 if(!detail||detail.study.status!=='active')throw Error('The linked study is no longer active');
 const entries=detail.entries.slice(-8);
 const hasMore=detail.hasMore||detail.entries.length>entries.length;
 return {study:detail.study,contract:detail.contract,hasMore,nextBefore:hasMore?entries[0]?.sequence:null,
  entries:entries.map(e=>({id:e.id,sequence:e.sequence,actor:e.actor,createdAt:e.created_at,type:e.payload.entryType,
   text:e.payload.text.slice(0,1200),truncated:e.payload.text.length>1200,isCurrent:e.isCurrent,correctedBy:e.correctedBy,
   predictionId:e.payload.input.predictionId,debriefId:e.payload.input.debriefId,evidence:e.payload.learningEvidence,
   href:`/learn/${studyId}/entries/${e.id}?leagueId=${encodeURIComponent(leagueId)}`}))};
}
