import {z} from 'zod';
export const browserOrigin=z.string().max(250).refine(value=>{
 try{const u=new URL(value);return u.origin===value&&u.protocol==='https:'&&!u.username&&!u.password&&u.port===''&&/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)&&!u.hostname.endsWith('.local')&&!u.hostname.endsWith('.internal')&&!u.hostname.endsWith('.localhost');}catch{return false;}
},'Use an exact public HTTPS origin without a path or custom port');
export const browserCreate=z.object({requestKey:z.uuid(),origins:z.array(browserOrigin).min(1).max(12).transform(v=>[...new Set(v)].sort())}).strict();
const op={id:z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/),epoch:z.number().int().positive()};
const viewed={...op,view:z.number().int().nonnegative()};
export const browserCommand=z.discriminatedUnion('action',[
 z.object({...op,action:z.literal('navigate'),url:z.url().max(3000)}).strict(),
 z.object({...op,action:z.literal('observe')}).strict(),
 z.object({...viewed,action:z.literal('click'),ref:z.string().regex(/^@e\d+$/)}).strict(),
 z.object({...viewed,action:z.literal('click_point'),x:z.number().int().min(0).max(1279),y:z.number().int().min(0).max(719)}).strict(),
 z.object({...viewed,action:z.literal('fill'),ref:z.string().regex(/^@e\d+$/),text:z.string().max(4000)}).strict(),
 z.object({...viewed,action:z.literal('press'),key:z.enum(['Enter','Tab','Shift+Tab','Escape','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'])}).strict(),
 z.object({...viewed,action:z.literal('scroll'),direction:z.enum(['up','down','left','right']),pixels:z.number().int().min(1).max(1024)}).strict(),
]);
export const browserMutation=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),input:browserCreate}).strict(),
 z.object({action:z.literal('stop'),id:z.uuid()}).strict(),
 z.object({action:z.literal('command'),id:z.uuid(),command:browserCommand}).strict(),
 z.object({action:z.literal('handoff'),id:z.uuid(),epoch:z.number().int().positive(),owner:z.enum(['human','agent'])}).strict(),
 z.object({action:z.literal('inspect'),id:z.uuid()}).strict(),
 z.object({action:z.literal('receipt'),id:z.uuid(),operationId:op.id}).strict(),
]);
export type ComputerKind='browser'|'desktop';
export type BrowserSession={kind?:ComputerKind;id:string;student_id:string;request_key:string;origins:string[];sealed_keys:string;state:'queued'|'provisioning'|'booting'|'ready'|'stopping'|'stopped';message:string;vm_name:string;provider_session_id:string|null;endpoint:string|null;provision_token:string|null;provision_uncertain:boolean;job_token:string|null;job_until:string|null;next_at:string;expires_at:string;reconcile_until:string;stop_requested_at:string|null;stopped_at:string|null;failures:number;worker_state:unknown;created_at:string};
export function publicBrowser(b:BrowserSession){return {kind:b.kind??'browser',id:b.id,origins:b.origins,state:b.state,message:b.message,expiresAt:b.expires_at,createdAt:b.created_at,stoppedAt:b.stopped_at,worker:b.worker_state,href:`/${b.kind==='desktop'?'computer':'browser'}/${b.id}`,reservedCredits:100,costStatus:'unpriced'};}
export type PublicBrowser=ReturnType<typeof publicBrowser>;
