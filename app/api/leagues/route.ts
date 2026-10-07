import { currentSession } from "../../../lib/session";
import { activeCatalog,defaultLeagueId } from "../../../lib/league-catalog";
import { listCatalogLeagues } from "../../../lib/softmax";
export async function GET(){
  const session=await currentSession();if(!session)return Response.json({error:"Sign in first"},{status:401});
  try{return Response.json({defaultLeagueId,leagues:activeCatalog(await listCatalogLeagues(session.token,AbortSignal.timeout(12000)))},{headers:{"Cache-Control":"private, no-store"}});}
  catch{return Response.json({error:"Could not load Softmax leagues."},{status:503});}
}
