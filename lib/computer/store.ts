import {randomBytes} from 'node:crypto';
import {sealJson} from '../crypto';
import {rpc} from '../tasks/store';
import {desktopEnabled} from '../browser/store';
import {publicBrowser,type BrowserSession} from '../browser/model';
import {desktopCreate} from './model';
export async function createDesktop(student:string,input:unknown){
 if(!desktopEnabled())throw Error('Virtual desktop provisioning is not enabled on this deployment');
 const p=desktopCreate.parse(input);
 const sealed=sealJson({student,requestKey:p.requestKey,kind:'desktop',humanKey:randomBytes(32).toString('hex'),agentKey:randomBytes(32).toString('hex')});
 return publicBrowser(await rpc<BrowserSession>('cloud_desktop_create',{p_student:student,p_key:p.requestKey,p_origins:p.origins,p_sealed:sealed}));
}
