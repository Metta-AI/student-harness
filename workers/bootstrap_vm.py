"""Runs only inside the auditor's remote VM. Provision one pinned audit environment."""
import hashlib, json, os, platform, re, shutil, subprocess, tarfile, urllib.request
from pathlib import Path

ROOT=Path('/workspace/audit'); ROOT.mkdir(parents=True,exist_ok=True)
status=ROOT/'bootstrap-status.json'
def save(value):
    tmp=status.with_suffix('.tmp');tmp.write_text(json.dumps(value));tmp.replace(status)
def run(*args):subprocess.run(list(map(str,args)),check=True)
def checkout(path,url,revision):
    if not (path/'.git').exists():
        path.mkdir(parents=True,exist_ok=True);run('git','-C',path,'init','-q');run('git','-C',path,'remote','add','origin',url)
    head=subprocess.run(['git','-C',str(path),'rev-parse','HEAD'],capture_output=True,text=True)
    if head.returncode or head.stdout.strip()!=revision:
        run('git','-C',path,'fetch','--depth','1','origin',revision);run('git','-C',path,'checkout','--detach','FETCH_HEAD')
try:
    config=json.loads((ROOT/'session.json').read_text());release=config['release']
    match=re.fullmatch(r'https://github.com/Metta-AI/polyworld/tree/([a-f0-9]{40})/examples/gods_of_the_arena',release['sourceUrl'])
    if not match:raise ValueError('Unsupported release source')
    if (ROOT/'engines.json').exists() and json.loads((ROOT/'engines.json').read_text()).get(release['fingerprint'],{}).get('probeBinary'):
        save({'state':'ready'});raise SystemExit(0)
    save({'state':'building','message':'Preparing pinned replay engine and dependencies'})
    # The VM is isolated from Preston and never receives Softmax or model credentials.
    if shutil.which('apt-get'):
        run('sudo','apt-get','update');run('sudo','apt-get','install','-y','git','build-essential','xz-utils','libssl-dev')
    elif shutil.which('dnf'):run('sudo','dnf','install','-y','git','gcc','gcc-c++','make','xz','openssl-devel')
    else:raise ValueError('Unsupported auditor VM package manager')
    engine=ROOT/'engine';deps=ROOT/'deps';checkout(engine,'https://github.com/Metta-AI/polyworld.git',match[1]);deps.mkdir(exist_ok=True)
    for line in (engine/'coworld/dependencies.lock').read_text().splitlines():
        if line.strip():
            name,_,url,revision=line.split();checkout(deps/name,url,revision)
    nim=ROOT/'nim-2.2.10/bin/nim'
    if not nim.exists():
        if platform.machine()!='x86_64':raise ValueError('Auditor bootstrap currently requires an x86_64 VM')
        archive=ROOT/'nim.tar.xz';run('curl','-fL','--retry','3','--max-time','120','-o',archive,'https://nim-lang.org/download/nim-2.2.10-linux_x64.tar.xz')
        if hashlib.sha256(archive.read_bytes()).hexdigest()!='0a3a38752e97e9d44aa479b3a7b37336dfe0176daf22ee5b5218ad0991ecd211':raise ValueError('Nim archive checksum mismatch')
        with tarfile.open(archive) as tape:tape.extractall(ROOT,filter='data')
    build_id=hashlib.sha256(b''.join(p.read_bytes() for p in sorted((ROOT/'native').glob('*.nim')))).hexdigest()[:16]
    run('python3',ROOT/'build_engines.py','--engine',engine,'--deps',deps,'--output',ROOT/'bin'/build_id,'--registry',ROOT/'engines.json','--source-url',release['sourceUrl'],'--fingerprint',release['fingerprint'],'--nim',nim)
    save({'state':'ready'})
except Exception as exc:
    save({'state':'failed','message':str(exc)[:1000]});raise
