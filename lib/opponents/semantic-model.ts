import { z } from 'zod';

const id = z.string().trim().min(1).max(80);
const text = z.string().trim().min(1).max(2000);
/** An observational model, never an executable reconstruction of private source. */
export const opponentSemanticSchema = z.object({
  schema: z.literal('gota-opponent-semantic-ir/1'),
  summary: text,
  evidence: z.array(z.object({
    id, snapshotId: z.uuid(), episodeId: z.string().min(1).max(200).optional(), detail: text,
  }).strict()).min(1).max(50),
  nodes: z.array(z.object({
    id, kind: z.enum(['situation', 'belief', 'goal', 'skill', 'strategy']),
    label: z.string().trim().min(1).max(160), claim: text,
    status: z.enum(['observed', 'hypothesis']),
    evidence: z.array(id).min(1).max(20),
    falsifier: text.optional().describe('Required for hypotheses: what observation would disprove this interpretation?'),
  }).strict()).max(50),
  edges: z.array(z.object({from: id, to: id, relation: z.enum(['applies_in', 'supports', 'uses', 'pursues'])}).strict()).max(100),
  unknowns: z.array(text).max(30),
  nextTests: z.array(text).max(20),
}).strict().superRefine((v, ctx) => {
  const fail = (message: string) => ctx.addIssue({code: 'custom', message});
  const evidence = new Set(v.evidence.map(e => e.id));
  const nodes = new Set(v.nodes.map(n => n.id));
  if (evidence.size !== v.evidence.length || nodes.size !== v.nodes.length) fail('IDs must be unique within evidence and nodes');
  for (const node of v.nodes) {
    if (node.evidence.some(id => !evidence.has(id))) fail(`Unknown evidence in ${node.id}`);
    if (node.status === 'observed' && !node.evidence.some(id => v.evidence.find(e => e.id === id)?.episodeId)) fail(`Observed behavior ${node.id} requires episode evidence, not just standings`);
    if (node.status === 'hypothesis' && !node.falsifier) fail(`Hypothesis ${node.id} requires a falsifier`);
    if (['belief', 'goal'].includes(node.kind) && node.status !== 'hypothesis') fail('Opponent beliefs and goals are interpretations, not observed internal state');
  }
  for (const edge of v.edges) if (!nodes.has(edge.from) || !nodes.has(edge.to)) fail('Edges must reference model nodes');
});
export type OpponentSemanticIR = z.infer<typeof opponentSemanticSchema>;
