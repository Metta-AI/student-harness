/** Coalesce concurrent reads; only immutable/help results may outlive the request. */
export class ReadCache<T> {
  private pending = new Map<string, Promise<T>>();
  private saved = new Map<string, { value: T; expires: number }>();
  private maxEntries: number;
  constructor(maxEntries = 64) { this.maxEntries = maxEntries; }
  async run(key: string, load: () => Promise<T>, options: { ttlMs?: number; cacheable?: (value: T) => boolean } = {}) {
    const now = Date.now();
    for (const [id, entry] of this.saved) if (entry.expires <= now) this.saved.delete(id);
    const saved = this.saved.get(key);
    if (saved) return { value: saved.value, reuse: 'cache' as const };
    const pending = this.pending.get(key);
    if (pending) return { value: await pending, reuse: 'inflight' as const };
    const work = Promise.resolve().then(load);
    this.pending.set(key, work);
    try {
      const value = await work;
      if (options.ttlMs && options.cacheable?.(value) !== false) {
        if (this.saved.size >= this.maxEntries) this.saved.delete(this.saved.keys().next().value!);
        this.saved.set(key, { value, expires: Date.now() + options.ttlMs });
      }
      return { value, reuse: 'none' as const };
    } finally { this.pending.delete(key); }
  }
}
