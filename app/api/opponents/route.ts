import { currentSession,sameOrigin } from '../../../lib/session';
import { defaultLeagueId,leagueIdSchema } from '../../../lib/league-catalog';
import { opponentResearch } from '../../../lib/opponents/store';
import { opponentToolSchema } from '../../../lib/opponents/model';
export async function GET(request:Request){return handle(request,false);}
export async function POST(request:Request){return handle(request,true);}
async function handle(request:Request,write:boolean){
 if(write&&!sameOrigin(request))return Response.json({error:'Invalid origin'},{status:403});
 const student=await currentSession();if(!student)return Response.json({error:'Sign in first'},{status:401});
 const url=new URL(request.url);const league=leagueIdSchema.safeParse(url.searchParams.get('league')??defaultLeagueId);if(!league.success)return Response.json({error:'Invalid league'},{status:400});
 let input;try{input=opponentToolSchema.parse(write?await request.json():url.searchParams.has('policy')?{action:'read',policyId:url.searchParams.get('policy')}:{action:'list'});}catch{return Response.json({error:'Check the policy, note and evidence link.'},{status:400});}
 try{return Response.json(await opponentResearch(student.subjectId,student.token,input,'human',league.data),{headers:{'Cache-Control':'no-store'}});}
 catch{return Response.json({error:'Opponent data could not be loaded or saved. Retry shortly.'},{status:503});}
}
