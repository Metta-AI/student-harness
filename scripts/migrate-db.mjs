import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!url) throw new Error('Set POSTGRES_URL_NON_POOLING or POSTGRES_URL before migrating.');
const files = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(f => /^\d+_[a-z_]+\.sql$/.test(f)).sort();
let sql = `\\set ON_ERROR_STOP on\nbegin;\nselect pg_advisory_xact_lock(729410);\ncreate table if not exists public.harness_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now());\n`;
for (const name of files) {
  const content = readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
  const hash = createHash('sha256').update(content).digest('hex');
  sql += `select exists(select 1 from public.harness_migrations where name='${name}') as applied \\gset\n\\if :applied\ndo $$ begin if not exists(select 1 from public.harness_migrations where name='${name}' and checksum='${hash}') then raise exception 'Applied migration changed: ${name}'; end if; end $$;\n\\else\n${content}\ninsert into public.harness_migrations(name,checksum) values('${name}','${hash}');\n\\endif\n`;
}
sql += 'commit;\n';
try { execFileSync('psql', ['-X', '-q', '--dbname', url], { input: sql, stdio: ['pipe', 'inherit', 'inherit'] }); }
catch { console.error('Migration failed; transaction rolled back.'); process.exit(1); }
console.log(`Checked ${files.length} migrations; unapplied migrations committed together.`);
