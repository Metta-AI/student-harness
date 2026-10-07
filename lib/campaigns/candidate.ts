import {z} from 'zod';
import {db} from '../db';
import {candidateProposalSchema,constructCandidate,type Baseline} from './model';

export class InvalidCandidate extends Error {}
/** Resolve citations against the shared evidence store, not only session summaries. */
export async function verifiedCandidate(studentId:string,leagueId:string,baseline:Baseline,input:unknown){
 const parsed=candidateProposalSchema.safeParse(input);
 if(!parsed.success)throw new InvalidCandidate(`Invalid candidate structure: ${parsed.error.message}`);
 const proposal=parsed.data,ids=[...new Set(proposal.components.flatMap(c=>c.evidence))];
 if(ids.some(id=>!z.uuid().safeParse(id).success))throw new InvalidCandidate('Candidate citations must be full artifact UUIDs');
 const {data,error}=await db().from('research_artifacts').select('id').eq('student_id',studentId).eq('league_id',leagueId).in('id',ids);
 if(error)throw Error(`Could not verify candidate evidence: ${error.message}`);
 const known=new Set((data??[]).map(e=>e.id));
 const missing=ids.filter(id=>!known.has(id));
 if(missing.length)throw new InvalidCandidate(`Candidate cites unavailable evidence: ${missing.join(', ')}`);
 try{return constructCandidate(baseline,proposal,known);}
 catch(error){throw new InvalidCandidate(error instanceof Error?error.message:String(error));}
}

/** Balance team and team ordinal before seeing any results. */
export function fixtureSeat(index:number){return Math.floor(index/2)%5+(index%2)*5;}
