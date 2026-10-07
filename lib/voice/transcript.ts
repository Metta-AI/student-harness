import { z } from "zod";
export const voiceEventSchema = z.object({
  event_id: z.string().min(1).max(200), sequence: z.number().int().nonnegative(),
  kind: z.enum(["transcript", "lifecycle", "tool"]), role: z.enum(["user", "assistant"]).nullable(),
  text: z.string().max(16000), start_ms: z.number().finite().nullable(), end_ms: z.number().finite().nullable(),
  received_at: z.iso.datetime(), after_message_id: z.string().max(200).nullable().optional(),
}).strict();
export type VoiceEvent = z.infer<typeof voiceEventSchema>;
export type TranscriptTurn = { role: "user" | "assistant"; text: string; start: number | null; end: number | null };
/** Display grouping only: retain exact raw fragments in storage, including overlap and repetitions. */
export function transcriptTurns(events: VoiceEvent[]): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const event of events.filter(e=>e.kind==='transcript'&&e.role).sort((a,b)=>(a.start_ms??a.sequence)-(b.start_ms??b.sequence)||a.sequence-b.sequence)) {
    const last=turns.at(-1);
    if (last && last.role===event.role && (event.start_ms===null || last.end===null || event.start_ms-last.end<1800)) {
      last.text+=event.text; last.end=event.end_ms;
    } else turns.push({role:event.role!,text:event.text,start:event.start_ms,end:event.end_ms});
  }
  return turns;
}
export const chatHistorySchema = z.array(z.object({role:z.enum(['user','assistant']),text:z.string().max(1500)})).max(12);
