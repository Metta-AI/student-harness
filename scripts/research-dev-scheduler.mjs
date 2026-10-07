// eve dev does not run cron. This local process keeps durable work moving after a browser closes.
const base = process.env.PRESTON_DEV_URL || 'http://localhost:3000';
const url = new URL('/eve/v1/dev/schedules/task-dispatch', base);
if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('The development scheduler only targets localhost. Use deployed Eve cron in production.');
let stopped = false;
process.on('SIGINT', () => { stopped = true; });
process.on('SIGTERM', () => { stopped = true; });
console.log(`Preston background dispatcher: ${url.origin} (every 15 seconds)`);
while (!stopped) {
  const start = Date.now();
  try {
    const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(60_000) });
    if (!response.ok) console.error(`Research dispatcher returned HTTP ${response.status}`);
  } catch (error) { console.error('Research dispatcher unavailable:', error.name); }
  if (!stopped) await new Promise(resolve => setTimeout(resolve, Math.max(1000, 15_000 - (Date.now()-start))));
}
