/** Bound database reads, including response bodies, without interrupting mutations. */
export function withDatabaseReadTimeout(fetcher: typeof fetch, timeoutMs = 10_000): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return fetcher(input, init);
    const deadline = AbortSignal.timeout(timeoutMs);
    const callerSignal = init?.signal ?? request?.signal;
    const signal = callerSignal ? AbortSignal.any([deadline, callerSignal]) : deadline;
    try {
      return await fetcher(input, { ...init, signal });
    } catch (error) {
      // PostgREST retries generic network errors. Cancellation must remain terminal.
      if (signal.aborted) throw new DOMException(deadline.aborted ? 'Database read timed out. Please retry.' : 'Database read canceled.', 'AbortError');
      throw error;
    }
  };
}
