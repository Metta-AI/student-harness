import { z } from "zod";

const versionSchema = z.object({
  id: z.string(), games: z.number(), record: z.object({ wins: z.number(), losses: z.number(), draws: z.number() }),
  values: z.record(z.string(), z.number()),
});
const snapshotSchema = z.object({
  generatedAt: z.string(), windowStart: z.string(), windowEnd: z.string(),
  players: z.array(z.object({ policyVersions: z.array(versionSchema) })),
});

export async function getPlayerSnapshot(policyId: string) {
  const response = await fetch("https://metta-ai.github.io/polyworld-buff/GOTA/players/data.json", { next: { revalidate: 3600 } });
  if (!response.ok) throw new Error(`Player snapshot returned ${response.status}`);
  const snapshot = snapshotSchema.parse(await response.json());
  const version = snapshot.players.flatMap((player) => player.policyVersions).find((item) => item.id === policyId);
  return version ? { windowStart: snapshot.windowStart, windowEnd: snapshot.windowEnd, generatedAt: snapshot.generatedAt, ...version } : null;
}
