"""Build release-pinned replay auditors on a research host. Never starts a game."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path


def command(*args, **kwargs):
    return subprocess.check_output(list(map(str, args)), text=True, **kwargs).strip()


def build(args):
    engine, deps, output = args.engine.resolve(), args.deps.resolve(), args.output.resolve()
    match = re.fullmatch(r'https://github.com/Metta-AI/polyworld/tree/([a-f0-9]{40})/examples/gods_of_the_arena', args.source_url)
    if not match or not re.fullmatch(r'[a-f0-9]{64}', args.fingerprint):
        raise ValueError('Supply the exact canonical source URL and manifest fingerprint')
    if command('git', '-C', engine, 'rev-parse', 'HEAD') != match[1]:
        raise ValueError('Engine checkout differs from canonical release')
    if command('git', '-C', engine, 'diff', 'HEAD', '--', 'src', 'examples/gods_of_the_arena', 'coworld/dependencies.lock'):
        raise ValueError('Engine has modified runtime source')
    flags = ['-d:headless', '-d:release', '-d:bassyNative', '-d:flatty64', '-d:nimTypeNames', '--hints:off',
             f'--path:{engine}/src', f'--path:{engine}/examples/gods_of_the_arena']
    revisions = {}
    for line in (engine/'coworld/dependencies.lock').read_text().splitlines():
        if not line.strip(): continue
        name, _, _, revision = line.split()
        path = deps/name
        if command('git', '-C', path, 'rev-parse', 'HEAD') != revision or command('git', '-C', path, 'status', '--porcelain'):
            raise ValueError(f'Dependency {name} differs from the release lockfile')
        flags.append('--path:'+str(path/'src' if (path/'src').is_dir() else path))
        revisions[name] = revision
    output.mkdir(parents=True, exist_ok=True)
    config = {'sourceUrl': args.source_url, 'dependencies': revisions, 'nim': command(args.nim, '--version')}
    for name, source in [('replayBinary','replay.nim'), ('vmBinary','subject_vm.nim'), ('validatorBinary','validate.nim'), ('probeBinary','subject_vm.nim')]:
        binary=output/name
        extra=['-d:candidateProbe'] if name=='probeBinary' else ['-d:replayEvents'] if name=='replayBinary' else []
        subprocess.run([args.nim, 'c', *flags, *extra, f'--out:{binary}', str(Path(__file__).parent/'native'/source)], check=True)
        config[name]=str(binary);config[name+'Sha256']=hashlib.sha256(binary.read_bytes()).hexdigest()
    registry = json.loads(args.registry.read_text()) if args.registry.exists() else {}
    registry[args.fingerprint]=config
    temporary=args.registry.with_suffix('.tmp');temporary.write_text(json.dumps(registry,indent=2)+'\n');temporary.replace(args.registry)
    print('Registered replay and VM auditors for '+args.fingerprint)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['engine','deps','output','registry']:p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--source-url',required=True);p.add_argument('--fingerprint',required=True);p.add_argument('--nim',default='nim')
    build(p.parse_args())
