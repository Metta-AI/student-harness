import {spawn} from 'node:child_process';
const next=spawn(process.execPath,['node_modules/next/dist/bin/next','dev',...process.argv.slice(2)],{stdio:'inherit'});
const args=process.argv.slice(2);const portIndex=args.findIndex(arg=>arg==='-p'||arg==='--port');
const port=(portIndex>=0?args[portIndex+1]:args.find(arg=>arg.startsWith('--port='))?.split('=')[1])||process.env.PORT||'3000';
const scheduler=spawn(process.execPath,['scripts/research-dev-scheduler.mjs'],{stdio:'inherit',env:{...process.env,PRESTON_DEV_URL:process.env.PRESTON_DEV_URL||`http://localhost:${port}`}});
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;next.kill('SIGTERM');scheduler.kill('SIGTERM');setTimeout(()=>process.exit(code),1000).unref();}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());next.on('exit',code=>stop(code??0));
