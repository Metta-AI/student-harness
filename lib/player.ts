import { setPolicyVersionPlayer, setStudentPlayer, studentPlayer } from "./db";
import { getDefaultPlayer, getPolicyVersionPlayer, type SoftmaxPlayer } from "./softmax";

/**
 * The player a student's next upload will be credited to: their default Softmax player.
 * Read from Softmax when `refresh` is set or nothing is stored yet, and kept on the student row so
 * the workspace does not call Softmax on every poll.
 */
export async function resolveStudentPlayer(subjectId: string, token: string, options: { refresh?: boolean } = {}): Promise<SoftmaxPlayer | null> {
  if (!options.refresh) {
    const stored = await studentPlayer(subjectId);
    if (stored) return stored;
  }
  const player = await getDefaultPlayer(token);
  if (player) await setStudentPlayer(subjectId, player);
  return player;
}

/** Fill in the player for versions uploaded before the app recorded it. Softmax is the authority. */
export async function backfillVersionPlayers(versions: { id: string; softmax_policy_version_id: string | null; softmax_player_name: string | null }[], token: string): Promise<Map<string, SoftmaxPlayer>> {
  const missing = versions.filter((version) => version.softmax_policy_version_id && !version.softmax_player_name);
  const found = new Map<string, SoftmaxPlayer>();
  await Promise.all(missing.map(async (version) => {
    const player = await getPolicyVersionPlayer(token, version.softmax_policy_version_id!).catch(() => null);
    if (!player) return;
    await setPolicyVersionPlayer(version.id, player);
    found.set(version.id, player);
  }));
  return found;
}
