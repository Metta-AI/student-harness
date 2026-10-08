import { z } from "zod";

const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export const screenActionSchema = z.object({
  grant: z.string().min(1).max(80).describe("Current browser grant from this turn's Preston context."),
  action: z.enum(["look", "move", "click", "select", "scroll", "draw", "clear"]),
  target: z.string().max(80).optional().describe("Target id from the latest look. Required for click/select; optional for move/scroll."),
  value: z.string().max(200).optional().describe("An existing option value for select."),
  point: point.optional().describe("Normalized coordinates in the WORKSPACE viewport, not the shared image."),
  points: z.array(point).min(2).max(80).optional().describe("Polyline in workspace viewport coordinates."),
  direction: z.enum(["up", "down"]).optional(),
  label: z.string().max(100).optional().describe("Short explanation shown beside Preston's cursor or drawing."),
}).strict();
export type ScreenAction = z.infer<typeof screenActionSchema>;
export const screenReceiptSchema = z.object({
  ok: z.boolean(), detail: z.string().max(1000),
  snapshot: z.string().max(24000).optional(),
  image: z.string().max(1_500_000).regex(/^[A-Za-z0-9+/=]+$/).optional(),
});
export type ScreenReceipt = z.infer<typeof screenReceiptSchema>;

/** A new sharing activation/control change fences every earlier queued command. */
export function authorizeScreenAction(action: ScreenAction, grant: string | null, control: boolean) {
  if (!grant || action.grant !== grant) throw new Error("Workspace access ended or changed. Inspect current access before trying again; do not retry an old grant.");
  if (action.action !== "look" && !control) throw new Error("Workspace control is off. The user can enable it in Preston's panel.");
}
