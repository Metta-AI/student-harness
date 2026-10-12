import {db} from '../db';
import {eventPageQuery,type CompanionEventPage} from './events';
export async function readCompanionEvents(student:string,input:unknown):Promise<CompanionEventPage>{
 const p=eventPageQuery.parse(input);
 const result=await db().rpc('companion_event_page',{p_student:student,p_league:p.leagueId,p_after:p.after??null,p_limit:p.limit});
 if(result.error)throw Error('Shared activity is unavailable; check the event-stream migration');
 return result.data as CompanionEventPage;
}
