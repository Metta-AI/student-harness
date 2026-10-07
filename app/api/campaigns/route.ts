import {z} from 'zod';
import {currentSession,sameOrigin} from '../../../lib/session';
import {campaignInputSchema} from '../../../lib/campaigns/model';
import {createCampaign,controlCampaign,checked} from '../../../lib/campaigns/store';
import {db} from '../../../lib/db';
export async function GET(){const student=await currentSession();if(!student)return Response.json({error:'Sign in first'},{status:401});try{return Response.json({campaigns:checked(await db().from('research_campaigns').select('id,task_id,objective,state,phase,cycle,updated_at').eq('student_id',student.subjectId).order('updated_at',{ascending:false}).limit(50))},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Campaigns unavailable'},{status:503});}}
export async function POST(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Invalid origin'},{status:403});const student=await currentSession();if(!student)return Response.json({error:'Sign in first'},{status:401});
 try{const c=await createCampaign(student.subjectId,campaignInputSchema.parse(await request.json()));return Response.json({campaign:c,url:`/sessions/${c.task_id}`},{status:201});}catch(e){return Response.json({error:e instanceof Error?e.message:'Could not start campaign'},{status:400});}
}
export async function PATCH(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Invalid origin'},{status:403});const student=await currentSession();if(!student)return Response.json({error:'Sign in first'},{status:401});
 try{const p=z.object({id:z.uuid(),action:z.enum(['pause','resume','cancel']),note:z.string().max(2000).optional()}).parse(await request.json());return Response.json({campaign:await controlCampaign(student.subjectId,p.id,p.action,p.note)});}catch(e){return Response.json({error:e instanceof Error?e.message:'Could not update campaign'},{status:400});}
}
