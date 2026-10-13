import {randomBytes} from 'node:crypto';
import {db} from '../db';
import {rpc} from '../tasks/store';
import {sealJson,unsealJson} from '../crypto';
import {browserCreate,publicBrowser,type BrowserSession,type ComputerKind} from './model';
export const browserEnabled=()=>process.env.CLOUD_BROWSER_ENABLED==='1';
export const desktopEnabled=()=>process.env.CLOUD_DESKTOP_ENABLED==='1';
export const computerEnabled=(kind:ComputerKind)=>kind==='desktop'?desktopEnabled():browserEnabled();
export async function createBrowser(student:string,input:unknown){
 if(!browserEnabled())throw Error('Cloud browser provisioning is not enabled on this deployment');
 const p=browserCreate.parse(input);
 const sealed=sealJson({student,requestKey:p.requestKey,humanKey:randomBytes(32).toString('hex'),agentKey:randomBytes(32).toString('hex')});
 return publicBrowser(await rpc<BrowserSession>('cloud_browser_create',{p_student:student,p_key:p.requestKey,p_origins:p.origins,p_sealed:sealed}));
}
export async function ownedBrowser(student:string,id:string,kind:ComputerKind='browser'){
 const r=await db().from('cloud_browser_sessions').select('*').eq('student_id',student).eq('id',id).maybeSingle();if(r.error)throw Error('Browser session could not be read');if(!r.data||(r.data.kind??'browser')!==kind)throw Error('Computer not found for this permission scope');return r.data as BrowserSession;
}
export async function listBrowsers(student:string,kind:ComputerKind='browser'){
 const r=await db().from('cloud_browser_sessions').select('*').eq('student_id',student).eq('kind',kind).order('created_at',{ascending:false}).limit(12);
 if(r.error){if(!computerEnabled(kind)&&['PGRST205','42P01'].includes(r.error.code))return {enabled:false,sessions:[]};throw Error('Browser sessions unavailable');}
 return {enabled:computerEnabled(kind),sessions:(r.data as BrowserSession[]).map(publicBrowser)};
}
export function browserKeys(b:BrowserSession){
 const keys=unsealJson(b.sealed_keys) as {student:string;requestKey:string;humanKey:string;agentKey:string;kind?:ComputerKind};
 if((keys.kind??'browser')!==(b.kind??'browser')||keys.student!==b.student_id||keys.requestKey!==b.request_key||![keys.humanKey,keys.agentKey].every(v=>/^[a-f0-9]{64}$/.test(v))||keys.humanKey===keys.agentKey)throw Error('Browser credentials do not match this account session');return keys;
}
export async function stopBrowser(student:string,id:string,kind:ComputerKind='browser'){await ownedBrowser(student,id,kind);return publicBrowser(await rpc<BrowserSession>('cloud_browser_stop',{p_student:student,p_id:id}));}
