/** Poll without superseding an in-flight read; stop on unmount or a changed resource. */
export function pollWhileVisible(read: (signal: AbortSignal) => Promise<void>, onError: (error: Error) => void) {
  const controller = new AbortController();
  let busy = false;
  const refresh = async () => {
    if (busy || controller.signal.aborted || document.visibilityState === 'hidden') return;
    busy = true;
    try {
      await read(AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
    } catch (error) {
      if (!controller.signal.aborted) onError(error instanceof Error && error.name === 'TimeoutError'
        ? new Error('This is taking too long to load. Please retry.')
        : error instanceof Error ? error : new Error('Could not load data. Please retry.'));
    } finally { busy = false; }
  };
  void refresh();
  const timer = window.setInterval(() => void refresh(), 10000);
  document.addEventListener('visibilitychange', refresh);
  return () => {
    controller.abort();
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', refresh);
  };
}
