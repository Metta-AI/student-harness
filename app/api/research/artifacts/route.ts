import {currentSession} from '../../../../lib/session';
import {findArtifacts,readArtifact} from '../../../../lib/campaigns/store';
import {defaultLeagueId} from '../../../../lib/league-catalog';
import {z} from 'zod';
export async function GET(request:Request){
 const student=await currentSession();if(!student)return Response.json({error:'Sign in first'},{status:401});
 const url=new URL(request.url),id=url.searchParams.get('id');
 if(id&&!z.uuid().safeParse(id).success)return Response.json({error:'Invalid artifact'},{status:400});
 const result=id?await readArtifact(student.subjectId,id):await findArtifacts(student.subjectId,url.searchParams.get('league')??defaultLeagueId,url.searchParams.get('q')??'',url.searchParams.get('kind')??undefined);
 return Response.json(result??{error:'Artifact not found'},{status:result?200:404,headers:{'Cache-Control':'no-store'}});
}
