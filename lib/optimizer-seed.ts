import { createHash } from 'node:crypto';
import type { SandboxSession } from 'eve/sandbox';
import { listWorkspaceFiles, upsertWorkspaceFiles } from './db';

export const SEED_REPO = 'https://github.com/Metta-AI/optimizer-seed';
export const SEED_BRANCH = 'aaln/semantic-ir-symbolic-loop';
export const SEED_DIR = '/workspace/optimizer-seed';
export const LAB_DIR = `${SEED_DIR}/games/gods-of-the-arena`;
const memoryRoots = ['games/gods-of-the-arena', 'WORKING_CONTEXT.md', 'TENTATIVE_LESSONS.md', 'best_practices.md', 'closed_levers.md', 'user_preferences.md', 'lessons_archive', 'docs/reports'];
const maxFiles = 400;
const maxBytes = 64 * 1024;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** Old saved seed boilerplate must not replace the harness's concrete game bindings. */
export function isUnfilledGoTaBinding(path:string,content:string) {
 return /^games\/gods-of-the-arena\/(MIXIN\.md|skills\/(ab|survey|replay-inspection|eval-design|diagnosis)\/SKILL\.md)$/.test(path)&&/\{\{GAME_(NAME|SLUG)\}\}/.test(content);
}

/** A missing optimizer is a failed environment build, never a usable empty lab. */
export async function prepareOptimizerSeed(sandbox: SandboxSession) {
  for (const command of [
    `git clone --depth 1 --branch ${SEED_BRANCH} ${SEED_REPO} ${SEED_DIR}`,
    `test -s ${SEED_DIR}/AGENTS.md && test -d ${SEED_DIR}/skills && test -s ${SEED_DIR}/games/_template/AGENTS.md`,
    `cp -r ${SEED_DIR}/games/_template ${LAB_DIR} && cp -R /workspace/gota-mixin/. ${LAB_DIR}/ && mkdir -p ${LAB_DIR}/docs && cp /workspace/docs/*.md ${LAB_DIR}/docs/`,
    `mkdir -p /workspace/.preston && git -C ${SEED_DIR} rev-parse HEAD > /workspace/.preston/optimizer-seed-version`,
  ]) {
    const result = await sandbox.run({ command });
    if (result.exitCode !== 0) throw Error(`Optimizer seed preparation failed: ${result.stderr || result.stdout}`.slice(0, 2000));
  }
}

// JSON preserves filenames, and errors propagate instead of being hidden by a pipeline.
export const memoryListingScript = `import json, pathlib, sys
root = pathlib.Path(sys.argv[1]).resolve()
if not (root / 'games/gods-of-the-arena').is_dir():
    raise RuntimeError('Optimizer lab is missing; saved memory was not changed')
paths, skipped = [], 0
for name in ${JSON.stringify(memoryRoots)}:
    base = root / name
    candidates = sorted(base.rglob('*')) if base.is_dir() and not base.is_symlink() else [base]
    for path in candidates:
        relative = path.relative_to(root)
        if '.git' in relative.parts or path.is_symlink() or not path.is_file():
            continue
        if any(parent.is_symlink() for parent in path.parents if parent != root and parent.is_relative_to(root)):
            continue
        if not path.resolve().is_relative_to(root):
            continue
        if path.stat().st_size > ${maxBytes} or len(paths) >= ${maxFiles}:
            skipped += 1
            continue
        paths.append(relative.as_posix())
print(json.dumps(dict(paths=paths, skipped=skipped)))`;

/** Absence in a VM is not authority to delete another session's durable research. */
export async function syncLabFiles(sandbox: SandboxSession, subjectId: string) {
  const listing = await sandbox.run({ command: `python3 -c ${quote(memoryListingScript)} ${quote(SEED_DIR)}` });
  if (listing.exitCode !== 0) throw Error('Could not list optimizer memory; saved research was left intact.');
  const manifest = JSON.parse(listing.stdout) as { paths: string[]; skipped: number };
  if (!Array.isArray(manifest.paths) || manifest.paths.length > maxFiles || !Number.isInteger(manifest.skipped) || manifest.skipped < 0 || manifest.paths.some(path =>
    typeof path !== 'string' || path.split('/').some(part => ['', '.', '..'].includes(part)) ||
    !memoryRoots.some(root => path === root || path.startsWith(`${root}/`))
  )) throw Error('Invalid optimizer memory listing; saved research was left intact.');
  const known = new Map((await listWorkspaceFiles(subjectId)).map(file => [file.path, file.sha256]));
  const changed: { path: string; content: string; sha256: string }[] = [];
  let skipped = manifest.skipped;
  for (const path of manifest.paths) {
    const content = await sandbox.readTextFile({ path: `${SEED_DIR}/${path}` });
    if (content === null || content.includes('\u0000') || Buffer.byteLength(content, 'utf8') > maxBytes) { skipped++; continue; }
    const sha256 = createHash('sha256').update(content).digest('hex');
    if (known.get(path) !== sha256) changed.push({ path, content, sha256 });
  }
  await upsertWorkspaceFiles(subjectId, changed);
  return { synced: changed.length, tracked: manifest.paths.length, skipped };
}
