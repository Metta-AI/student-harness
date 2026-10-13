import { db } from '../db';
import { readCompanionContext } from './context-store';
import type { ContextOptions } from './context';

export async function recallReceipt(studentId: string, scopeKey: string, operationId: string, options: ContextOptions, signal?: AbortSignal) {
  const client = db();
  const read = async () => {
    const query = client.from('companion_memory_receipts').select('content')
      .eq('student_id', studentId).eq('scope_key', scopeKey).eq('operation_id', operationId);
    if (signal) query.abortSignal(signal);
    const result = await query.maybeSingle();
    if (result.error) throw new Error('Shared memory receipts unavailable. Apply the companion memory migration before starting the agent.');
    return result.data?.content as string | undefined;
  };
  const prior = await read();
  if (prior !== undefined) return prior;
  const content = JSON.stringify(await readCompanionContext(studentId, options));
  if (signal?.aborted) throw signal.reason;
  const saved = await client.from('companion_memory_receipts').upsert({ student_id: studentId, scope_key: scopeKey, operation_id: operationId, content },
    { onConflict: 'scope_key,operation_id', ignoreDuplicates: true });
  if (saved.error) throw new Error('Could not save shared memory recall receipt');
  // Concurrent retries choose the first committed receipt, never their own uncommitted projection.
  const committed = await read();
  if (committed === undefined) throw new Error('Shared memory receipt did not commit');
  return committed;
}
