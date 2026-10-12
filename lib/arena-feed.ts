import { createHash } from 'node:crypto';
import { getExperience, getLeague, listExperiencesPage } from './softmax';

/** Share overlapping tab refreshes; failures also back off instead of retrying immediately. */
function memo<T>(entries: Map<string, { until: number; pending: Promise<T> }>, key: string, ms: number, load: () => Promise<T>) {
  const cached = entries.get(key);
  if (cached && cached.until > Date.now()) return cached.pending;
  if (entries.size >= 200) entries.delete(entries.keys().next().value!);
  const entry = { until: Infinity, pending: Promise.resolve().then(load) };
  entries.set(key, entry);
  void entry.pending.then(() => { entry.until = Date.now() + ms; }, () => { entry.until = Date.now() + 30000; });
  return entry.pending;
}
type Detail = Awaited<ReturnType<typeof getExperience>>;
const details = new Map<string, { until: number; pending: Promise<Detail> }>();
async function loadFeed(token: string, cursor?: string) {
  const [league, page] = await Promise.all([getLeague(token), listExperiencesPage(token, cursor)]);
  const identity = createHash('sha256').update(token).digest('hex');
  const runs: Detail[] = [];
  // Hard bound even if the upstream API ignores its requested page size.
  for (const item of page.entries.slice(0, 20)) {
    const terminal = ['completed', 'failed', 'canceled', 'cancelled'].includes(item.status);
    runs.push(await memo(details, identity + ':' + item.id, terminal ? 600000 : 60000, async () => {
      const detail = await getExperience(token, item.id);
      // No unbounded Promise.all burst on a cold cache.
      await new Promise(resolve => setTimeout(resolve, 250));
      return detail;
    }));
  }
  const episodes = runs.flatMap(run => run.episodes.map(episode => ({ ...episode, run_id: run.id, run_title: run.title, coworld_id: run.coworld_id })));
  episodes.sort((a, b) => new Date(b.completed_at ?? b.created_at).getTime() - new Date(a.completed_at ?? a.created_at).getTime());
  return { league, episodes, nextCursor: page.next_cursor };
}
const feeds = new Map<string, { until: number; pending: Promise<Awaited<ReturnType<typeof loadFeed>>> }>();
export function arenaFeed(token: string, cursor?: string) {
  const key = createHash('sha256').update(token).digest('hex') + ':' + (cursor ?? '');
  return memo(feeds, key, 60000, () => loadFeed(token, cursor));
}
