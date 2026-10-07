import { wikiPages } from "./policy-wiki.ts";
import { z } from "zod";
export const workspaceTabs = ["performance", "strategy", "experiments", "episodes", "opponents", "development"] as const;
export type WorkspaceTab = typeof workspaceTabs[number];
export const viewSchema = z.object({
  view: z.enum([...workspaceTabs, "custom"]),
  opponentPolicyId: z.uuid().optional(),
  artifactId: z.uuid().optional(),
  experimentId: z.string().regex(/^xreq_[0-9a-f-]{36}$/).optional(),
  wikiPage: z.enum(wikiPages).optional(),
  entityId: z.string().min(1).max(200).optional(),
  revision: z.number().int().positive().optional(),
  cycleId: z.uuid().optional(),
  branchId: z.string().min(1).max(160).optional(),
  last: z.union([z.literal(10), z.literal(25), z.literal(50)]).default(10),
  opponent: z.string().max(200).optional(),
  highlight: z.enum(["outcomes", "ranking", "versions", "branch", "evidence", "source"]).optional(),
  reason: z.string().min(1).max(500),
}).strict();
export type WorkspaceView = z.infer<typeof viewSchema>;
export const presentationInputSchema = z.object({
  requestToken: z.string().min(1).max(100).describe("Use the current presentation.requestToken from client context; this fences outdated answers."),
  ...viewSchema.shape,
}).strict();
export type PresentationRequest = z.infer<typeof presentationInputSchema>;
export type PresentationState = { current: WorkspaceView | null; history: WorkspaceView[]; pinned: boolean; pending: WorkspaceView | null; open: boolean };
export const initialPresentation: PresentationState = { current: null, history: [], pinned: false, pending: null, open: false };
export function showPresentation(state: PresentationState, view: WorkspaceView): PresentationState {
  if (state.pinned && state.current) return { ...state, pending: view };
  return { ...state, current: view, history: state.current ? [...state.history.slice(-9), state.current] : state.history, pending: null, open: true };
}
export function backPresentation(state: PresentationState): PresentationState {
  if (!state.history.length) return state;
  return { ...state, current: state.history.at(-1)!, history: state.history.slice(0, -1), pinned: false, pending: null };
}
export function presentationRoute(view: WorkspaceView) {
  const params = new URLSearchParams({ view: view.view });
  if (view.opponentPolicyId) params.set("opponentPolicy",view.opponentPolicyId);
  if (view.experimentId) params.set("experiment",view.experimentId);
  if (view.wikiPage) params.set("wiki",view.wikiPage);
  if (view.entityId) params.set("entity",view.entityId);
  if (view.artifactId) params.set("artifact",view.artifactId);
  if (view.revision) params.set("revision", String(view.revision));
  if (view.cycleId) params.set("cycle", view.cycleId);
  if (view.branchId) params.set("branch", view.branchId);
  if (view.opponent) params.set("opponent", view.opponent);
  params.set("last", String(view.last));
  return `/?${params}`;
}
