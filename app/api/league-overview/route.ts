import { z } from "zod";
import { currentSession } from "../../../lib/session";
import { defaultLeagueId,leagueIdSchema } from "../../../lib/league-catalog";
import { readLeagueOverview } from "../../../lib/league-overview";
export async function GET(request:Request){
 const student=await currentSession();if(!student)return Response.json({error:"Sign in first"},{status:401});
 const query=z.object({league:leagueIdSchema.default(defaultLeagueId),division:z.string().regex(/^div_[0-9a-f-]{36}$/).optional()}).safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if(!query.success)return Response.json({error:"Invalid league or division"},{status:400});
 try{return Response.json(await readLeagueOverview(student.token,query.data.league,query.data.division),{headers:{"Cache-Control":"private, no-store"}});}
 catch{return Response.json({error:"League data is unavailable. Check the selected league and try again."},{status:503});}
}
