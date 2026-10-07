type QueuedAttempt={state:string;xp_id:string|null;next_at:string};
const terminal=new Set(['complete','infra_failed','invalid']);

/** A burst of classified, unscored transport failures indicates a host outage.
 * Keep polling issued games, but give the host time to recover before spending
 * the exact-input retry allowance. Isolated failures retain normal retries. */
export function transportCooldownUntil(attempts:{state:string;updated_at?:string;attempt?:number}[],now=Date.now()):number|null{
 const recent=attempts.filter(a=>a.state==='infra_failed'&&Number.isFinite(Date.parse(a.updated_at??''))
  &&Date.parse(a.updated_at!)>now-15*60_000&&Date.parse(a.updated_at!)<=now);
 if(recent.length<3)return null;
 const until=Math.max(...recent.map(a=>Date.parse(a.updated_at!)+Math.min(15,3*((a.attempt??0)+1))*60_000));
 return until>now?until:null;
}

/** Hosted execution and native auditing use independent capacity. A completed
 * hosted game awaiting its audit must not block the next frozen fixture. Keep
 * each queue bounded and reconcile uncertain submissions before creating more. */
export function attemptBatch<T extends QueuedAttempt>(attempts:T[],concurrency:number,running:boolean,now=Date.now()):T[]{
 if(!Number.isInteger(concurrency)||concurrency<1)throw Error('Concurrency must be a positive integer');
 const active=attempts.filter(a=>!terminal.has(a.state));
 const due=active.filter(a=>Date.parse(a.next_at)<=now&&(running||!!a.xp_id));
 const hosted=active.filter(a=>a.state!=='auditing'&&(a.xp_id||a.state==='submitting'));
 const reconcile=due.filter(a=>a.state!=='auditing'&&(a.xp_id||a.state==='submitting')).slice(0,concurrency);
 const slots=running?Math.max(0,concurrency-hosted.length):0;
 const submit=due.filter(a=>a.state!=='auditing'&&!a.xp_id&&a.state!=='submitting').slice(0,Math.min(slots,concurrency-reconcile.length));
 const audits=due.filter(a=>a.state==='auditing'&&a.xp_id).slice(0,concurrency);
 // Resolve uncertain submissions first, then fill known free host capacity.
 // Reconciling completed games can download/audit large replays; doing that
 // before submissions can exhaust the poll deadline with the host left idle.
 return [...reconcile.filter(a=>!a.xp_id),...submit,...reconcile.filter(a=>!!a.xp_id),...audits];
}
