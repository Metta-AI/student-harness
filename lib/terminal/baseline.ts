import type {SandboxSession} from 'eve/sandbox';
import type {SessionAuth} from 'eve/context';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {apiJSON,resolveBaselines} from '../campaigns/provider';
import {listLeagueMemberships} from '../softmax';

const leagueId='league_3c60897b-25cf-4b37-9d1a-8554c1198f28';
export const terminalPolicyContextSchema=z.object({leagueId:z.string(),policyId:z.uuid().optional()});
const marker='/workspace/autoresearch/live-baseline.json';

/** Initialize once. Reopening a research workspace must never reset its candidate. */
export async function prepareCurrentBaseline(sandbox:SandboxSession,token:string,studentId:string,auth:SessionAuth) {
 if(await sandbox.readTextFile({path:marker})!==null||await sandbox.readTextFile({path:'/workspace/autoresearch/runtime/config.json'})!==null)return;
 const principal=auth.current??auth.initiator;
 const raw=principal?.attributes.terminalPolicyContext;
 const context=raw===undefined?{leagueId}:terminalPolicyContextSchema.parse(JSON.parse(z.string().parse(raw)));
 if(context.leagueId!==leagueId)throw Error('Hosted policy research currently supports the default Gods of the Arena league.');
 let playerIds:string[]=[];
 if(context.policyId){
  const [players,members]=await Promise.all([apiJSON(token,'/players'),listLeagueMemberships(token,undefined,leagueId)]);
  const owned=z.array(z.object({id:z.string(),disabled_at:z.string().nullable().optional()})).parse(players).filter(p=>!p.disabled_at);
  // A saved session can name a superseded version: retain its player, resolve their live champion below.
  playerIds=[...new Set(members.filter(m=>m.policy_version.id===context.policyId&&m.player&&owned.some(p=>p.id===m.player!.id)).map(m=>m.player!.id))];
  if(playerIds.length!==1)throw Error('Could not identify the owned player for this workspace policy. Refresh the workspace before starting research.');
 }
 const resolved=await resolveBaselines(token,leagueId,playerIds,studentId);
 const baseline=resolved.baselines[0];
 if(createHash('sha256').update(baseline.source).digest('hex')!==baseline.sourceHash)throw Error('Live baseline source hash mismatch');
 const receipt={leagueId,verifiedAt:new Date().toISOString(),...resolved};
 await sandbox.writeTextFile({path:'/workspace/.preston/live-baseline.pending.json',content:JSON.stringify(receipt)});
 const script=`import pathlib,json,hashlib,os
root=pathlib.Path('/workspace')
data=json.loads((root/'.preston/live-baseline.pending.json').read_text())
source=data['baselines'][0]['source'].encode()
assert hashlib.sha256(source).hexdigest()==data['baselines'][0]['sourceHash']
research=root/'autoresearch'
research.mkdir(exist_ok=True)
marker=research/'live-baseline.json'
if not marker.exists() and not (research/'runtime/config.json').exists():
 for name,backup in [('hero.bas','draft-before-live-baseline.bas'),('autoresearch/baseline.bas','baseline-before-live-baseline.bas')]:
  old=root/name
  saved=research/backup
  if old.exists() and not saved.exists(): saved.write_bytes(old.read_bytes())
 for target in [root/'hero.bas',research/'baseline.bas']:
  pending=target.with_name(target.name+'.pending')
  pending.write_bytes(source)
  os.replace(pending,target)
 os.replace(root/'.preston/live-baseline.pending.json',marker)
print('Verified live baseline: '+data['baselines'][0]['versionId']+' ('+data['baselines'][0]['sourceHash']+')')`;
 const result=await sandbox.run({command:`python3 -c '${script.replaceAll("'","'\\''")}'`,workingDirectory:'/workspace'});
 if(result.exitCode!==0)throw Error('Could not stage the verified live baseline: '+result.stderr.slice(-1000));
}
