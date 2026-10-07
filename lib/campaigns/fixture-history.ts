import {db} from '../db';
import {checked} from './store';

type Exclusion={episode_id:string;seed_key:string|null};

/** Read all observed and reserved seeds, including history beyond one API page.
 * Database reservation constraints remain the final guard against concurrent work. */
export async function fixtureHistory(studentId:string,leagueId:string):Promise<Exclusion[]>{
 const histories=await Promise.all((['research_fixtures','research_exclusions'] as const).map(async table=>{
  const rows:Exclusion[]=[];let cursor:string|undefined;
  for(;;){
   let query=db().from(table).select('episode_id,seed_key').eq('student_id',studentId).eq('league_id',leagueId).order('episode_id').limit(500);
   if(cursor!==undefined)query=query.gt('episode_id',cursor);
   const page=checked(await query) as Exclusion[];
   rows.push(...page);if(page.length<500)return rows;
   cursor=page.at(-1)!.episode_id;
  }
 }));
 return histories.flat();
}
