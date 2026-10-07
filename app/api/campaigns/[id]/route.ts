import {currentSession,sameOrigin} from '../../../../lib/session';
import {campaignDetail} from '../../../../lib/campaigns/store';
import {rpc} from '../../../../lib/tasks/store';
import {modelSelectionSchema} from '../../../../lib/model-selection';
import {z} from 'zod';
export async function GET(_r:Request,{params}:{params:Promise<{id:string}>}){
 const student=await currentSession();if(!student)return Response.json({error:'Sign in first'},{status:401});
 const id=z.uuid().safeParse((await params).id);if(!id.success)return Response.json({error:'Invalid campaign'},{status:400});
 const detail=await campaignDetail(student.subjectId,id.data);return Response.json(detail??{error:'Campaign not found'},{status:detail?200:404,headers:{'Cache-Control':'no-store'}});
}
export async function PATCH(r:Request,{params}:{params:Promise<{id:string}>}){
 if(!sameOrigin(r))return Response.json({error:'Invalid origin'},{status:403});
 const student=await currentSession();if(!student)return Response.json({error:'Sign in first'},{status:401});
 const id=z.uuid().safeParse((await params).id),selection=modelSelectionSchema.safeParse(await r.json().catch(()=>null));
 if(!id.success||!selection.success)return Response.json({error:'Invalid campaign or model selection'},{status:400});
 try{
  const modelSelection=await rpc('campaign_set_model',{p_id:id.data,p_student:student.subjectId,p_selection:selection.data});
  return Response.json({modelSelection},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Could not update this campaign’s model.'},{status:409});}
}
