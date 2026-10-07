/** Only a definitive inactive-session rejection is safe to resend. Never retry a network/turn/tool failure. */
export function isInactiveSession(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: string; message?: string };
  return value.code === 'session_not_active' || value.message === 'The session is no longer active.';
}

export async function sendWithSessionRecovery(send: (recovered: boolean) => Promise<unknown>, reset: () => void): Promise<void> {
  try { await send(false); }
  catch (error) {
    if (!isInactiveSession(error)) throw error;
    reset();
    await send(true); // Once only; the rejected message was never accepted by the old session.
  }
}
