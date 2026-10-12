import {Sandbox} from '@vercel/sandbox';
import {getVercelOidcToken} from '@vercel/oidc';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {db} from '../db';
import {sealJson,unsealJson} from '../crypto';
import {containerProviderCredentials} from '../container-policy/provider-credentials';
import {studentToken} from '../db';
import {defaultChatModel,gatewayModelIds} from '../model-selection';

/** Hermes mode runs one long-lived Hermes gateway per account in a persistent,
 * named Vercel Sandbox. Every Hermes conversation of that account shares it;
 * each conversation is its own Hermes session. Credentials never enter the VM:
 * AI Gateway, Softmax and the harness MCP server receive their Authorization
 * headers from the sandbox network policy. */
/** Bump the suffix to rebuild the base image without changing the upstream pin. */
export const HERMES_VERSION='v0.21.7+2';
const HERMES_COMMIT='71d34bad1045610252eda02ee79549436896e784';
const PORT=8642;
const HOME='/vercel/.hermes',WORKSPACE='/vercel/workspace';
const LEASE_MS=4*60*60*1000;

export function hermesSandboxName(student:string){return `preston-hermes-${createHash('sha256').update(student).digest('hex').slice(0,20)}`;}

/** Origin of the harness MCP server Hermes calls. Local development points at
 * the hosted deployment, because a cloud sandbox cannot reach localhost. */
export function hermesMcpOrigin(){
 const value=process.env.HERMES_MCP_ORIGIN?.trim()||process.env.PRESTON_RUNTIME_URL?.trim()||(process.env.VERCEL_PROJECT_PRODUCTION_URL?`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`:'')||'https://student-harness-seven.vercel.app';
 const url=new URL(value);if(url.protocol!=='https:')throw Error('Hermes MCP origin must be HTTPS');return url.origin;
}
/** Account-scoped bearer for the harness MCP server; HMAC under SESSION_SECRET. */
export function hermesMcpToken(student:string){
 const mac=createHmac('sha256',Buffer.from(process.env.SESSION_SECRET??'','hex')).update(`hermes-mcp:${student}`).digest('base64url');
 return `${Buffer.from(student).toString('base64url')}.${mac}`;
}
export function verifyHermesMcpToken(token:string):string|null{
 const [encoded]=token.split('.');if(!encoded)return null;
 const student=Buffer.from(encoded,'base64url').toString('utf8');
 const expected=hermesMcpToken(student);
 if(expected.length!==token.length)return null;
 let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^token.charCodeAt(i);
 return diff===0?student:null;
}

const INSTALL=`set -euo pipefail
curl -fsSL https://hermes-agent.nousresearch.com/install.sh -o /tmp/hermes-install.sh
CI=1 bash /tmp/hermes-install.sh --commit ${HERMES_COMMIT} --non-interactive --skip-browser --skip-computer-use
"$HOME/.local/bin/hermes" --version`;

/** On Vercel the OIDC token arrives with each request, not in the environment;
 * the helper reads it from the request context and falls back to the env
 * locally. It expires, so it is re-read and re-applied on every turn. */
async function gatewayCredential(){
 const value=process.env.AI_GATEWAY_API_KEY||await getVercelOidcToken().catch(()=>process.env.VERCEL_OIDC_TOKEN);
 if(!value)throw Error('Vercel AI Gateway credentials are required for Hermes mode.');
 return value;
}
async function networkPolicy(student:string){
 const mcp=new URL(hermesMcpOrigin()).hostname;
 return {allow:{
  'ai-gateway.vercel.sh':[{transform:[{headers:{authorization:`Bearer ${await gatewayCredential()}`}}]}],
  'softmax.com':[{transform:[{headers:{authorization:`Bearer ${await studentToken(student)}`}}]}],
  'observatory-private.s3.amazonaws.com':[],
  [mcp]:[{transform:[{headers:{authorization:`Bearer ${hermesMcpToken(student)}`}}]}],
  'github.com':[],'codeload.github.com':[],'raw.githubusercontent.com':[],
 }};
}

/** Hermes config for the shared gateway. The model is chosen per request, so
 * one gateway serves conversations on different models. */
function configYaml(){
 return `model:
  provider: ai-gateway
  default: ${gatewayModelIds[defaultChatModel]}
  base_url: https://ai-gateway.vercel.sh/v1
fallback_providers: []
terminal:
  backend: local
  cwd: /vercel/workspace
agent:
  max_turns: 150
approvals:
  mode: smart
  unattended_mode: deny
  deny:
    - "coworld submit*"
    - "coworld player use*"
    - "coworld download*"
    - "coworld run-episode*"
    - "softmax login*"
gateway:
  platforms:
    api_server:
      direct_model_requests: true
mcp_servers:
  preston:
    url: "${hermesMcpOrigin()}/hermes/mcp"
    timeout: 600
check_for_updates: false
`;
}

async function baseSnapshot():Promise<string|null>{
 const row=await db().from('hermes_images').select('snapshot_id').eq('version',HERMES_VERSION).maybeSingle();
 return row.data?.snapshot_id??null;
}
async function run(sandbox:Sandbox,script:string,{sudo=false,timeoutMs=600000,env}:{sudo?:boolean;timeoutMs?:number;env?:Record<string,string>}={}){
 const result=await sandbox.runCommand({cmd:'bash',args:['-lc',script],sudo,env,signal:AbortSignal.timeout(timeoutMs)});
 const [out,err]=await Promise.all([result.stdout(),result.stderr()]);
 if(result.exitCode!==0)throw Error(`Hermes host command failed (${result.exitCode}): ${(err||out).slice(-600)}`);
 return out;
}

/** Builds the shared base image once per Hermes version: Hermes installed,
 * nothing account-specific. */
export async function ensureHermesImage(){
 const existing=await baseSnapshot();if(existing)return existing;
 const sandbox=await Sandbox.create({...containerProviderCredentials(),timeout:30*60000,resources:{vcpus:2},networkPolicy:'allow-all',tags:{purpose:'preston-hermes-image',version:HERMES_VERSION},signal:AbortSignal.timeout(120000)});
 try{
  await run(sandbox,INSTALL,{timeoutMs:20*60000});
  const snapshot=await sandbox.snapshot({signal:AbortSignal.timeout(600000)});
  await db().from('hermes_images').upsert({version:HERMES_VERSION,snapshot_id:snapshot.snapshotId});
  return snapshot.snapshotId;
 }catch(error){try{await sandbox.stop();}catch{}throw error;}
}

type Host={student:string;name:string;key:string;url:string;sandbox:Sandbox};
async function hostRow(student:string){
 const row=await db().from('hermes_hosts').select('sandbox_name,api_key_sealed,hermes_version').eq('student_id',student).maybeSingle();
 if(row.error)throw Error('Hermes host record unavailable');
 return row.data;
}
async function healthy(url:string,key:string){
 try{const r=await fetch(`${url}/health`,{headers:{authorization:`Bearer ${key}`},signal:AbortSignal.timeout(8000)});return r.ok;}catch{return false;}
}
async function startGateway(sandbox:Sandbox,key:string){
 await run(sandbox,`mkdir -p ${HOME} ${WORKSPACE}`);
 await sandbox.writeFiles([
  {path:`${HOME}/config.yaml`,content:Buffer.from(configYaml())},
  {path:`${HOME}/.env`,content:Buffer.from(`API_SERVER_ENABLED=true\nAPI_SERVER_HOST=0.0.0.0\nAPI_SERVER_PORT=${PORT}\nAPI_SERVER_KEY=${key}\nAI_GATEWAY_API_KEY=placeholder-injected-at-network-boundary\nAI_GATEWAY_BASE_URL=https://ai-gateway.vercel.sh/v1\n`)},
 ]);
 // The gateway's command line ends in "gateway run" after a long Python
 // launcher, and a second gateway exits while the first holds the lock, so stop
 // the old one and wait for it to exit before starting with the new config.
 const gateway='[h]ermes_cli.main import main.*gateway run';
 await run(sandbox,`chmod 600 ${HOME}/.env; export PATH="$HOME/.local/bin:$PATH" HERMES_HOME=${HOME}
timeout 20 hermes gateway stop >/dev/null 2>&1 || true
pkill -f "${gateway}" || true
for i in $(seq 1 20); do pgrep -f "${gateway}" >/dev/null || break; sleep 1; done
pkill -9 -f "${gateway}" || true; sleep 1
rm -f ${HOME}/gateway.pid ${HOME}/gateway.lock ${HOME}/gateway.sock`,{timeoutMs:90000});
 await sandbox.runCommand({cmd:'bash',args:['-lc',`export PATH="$HOME/.local/bin:$PATH"; export HERMES_HOME=${HOME}; nohup hermes gateway run > ${HOME}/gateway.log 2>&1 &`],detached:true});
 await sandbox.writeFiles([{path:`${HOME}/.preston-gateway-config`,content:Buffer.from(configYaml())}]);
}

/** Returns a running shared Hermes gateway for this account, creating or
 * waking the sandbox as needed. */
export async function ensureHermesHost(student:string):Promise<Host>{
 const name=hermesSandboxName(student);
 let row=await hostRow(student),sandbox:Sandbox|null=null,key:string;
 if(row&&row.hermes_version===HERMES_VERSION){
  key=String(unsealJson(row.api_key_sealed));
  try{sandbox=await Sandbox.get({...containerProviderCredentials(),name,resume:true,signal:AbortSignal.timeout(60000)});}catch{sandbox=null;}
 }else key=randomBytes(24).toString('base64url');
 if(!sandbox){
  const snapshotId=await ensureHermesImage();
  try{const stale=await Sandbox.get({...containerProviderCredentials(),name,resume:false,signal:AbortSignal.timeout(30000)});await stale.delete({deleteOrphanSnapshots:true});}catch{}
  sandbox=await Sandbox.create({...containerProviderCredentials(),name,source:{type:'snapshot',snapshotId},persistent:true,ports:[PORT],timeout:LEASE_MS,resources:{vcpus:2},
   networkPolicy:await networkPolicy(student) as never,tags:{purpose:'preston-hermes',account:name.slice(-8)},signal:AbortSignal.timeout(120000)});
  await db().from('hermes_hosts').upsert({student_id:student,sandbox_name:name,api_key_sealed:sealJson(key),hermes_version:HERMES_VERSION,updated_at:new Date().toISOString()});
  row=await hostRow(student);
 }else{
  await sandbox.updateNetworkPolicy(await networkPolicy(student) as never);
  try{await sandbox.extendTimeout(LEASE_MS);}catch{}
 }
 const url=sandbox.domain(PORT).replace(/\/$/,'');
 // A changed config (new MCP origin, deny rules) needs a gateway restart.
 // The marker is written only when a gateway starts, so it names the config
 // the running gateway actually loaded.
 const current=await run(sandbox,`cat ${HOME}/.preston-gateway-config 2>/dev/null || true`).catch(()=> '');
 const stale=current.trim()!==configYaml().trim();
 if(stale||!await healthy(url,key)){
  await startGateway(sandbox,key);
  for(let i=0;i<60&&!await healthy(url,key);i++)await new Promise(r=>setTimeout(r,2000));
  if(!await healthy(url,key)){
   const log=await run(sandbox,`tail -c 2000 ${HOME}/gateway.log || true`).catch(()=> '');
   throw Error(`Hermes gateway did not become ready. ${log.slice(-800)}`);
  }
 }
 return {student,name,key,url,sandbox};
}
