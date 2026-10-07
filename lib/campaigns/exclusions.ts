import {db} from '../db';
import {checked} from './store';
import {episodeArtifact} from './provider';

/** Compiler-failed episodes may never publish results. Their immutable request
 * fixture still identifies the consumed seed; never drop an exclusion to proceed. */
export async function observedSeed(studentId:string,leagueId:string,token:string,episodeId:string):Promise<number>{
 const attempt=checked(await db().from('research_attempts')
  .select('research_fixtures!inner(student_id,league_id,fixture)')
  .eq('episode_id',episodeId).eq('research_fixtures.student_id',studentId)
  .eq('research_fixtures.league_id',leagueId).maybeSingle()) as {research_fixtures:{fixture:{seed:number}}}|null;
 let seed:unknown=attempt?.research_fixtures?.fixture.seed;
 if(!attempt){
  try{seed=(await episodeArtifact(token,episodeId,'results')).seed;}
  catch(error){
   if(!/Softmax 404:/.test(String(error)))throw error;
   seed=(await episodeArtifact(token,episodeId,'spec')).game_config?.seed;
  }
 }
 if(typeof seed!=='number'||!Number.isInteger(seed))throw Error('Observed episode seed is unavailable');
 return seed;
}
