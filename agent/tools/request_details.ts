import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";

const field = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/).describe("Snake-case key for this answer."),
  label: z.string().min(2).max(60).describe("What the student sees next to the control."),
  kind: z.enum(["text", "choice", "toggle"]).describe("text is a short typed answer, choice is one of `options`, toggle is yes or no."),
  options: z.array(z.string().min(1).max(40)).min(2).max(5).optional().describe("Required for kind choice."),
  default: z.string().max(120).optional().describe("Starting value: the text, one of the options, or \"true\"/\"false\" for a toggle."),
  required: z.boolean().optional(),
});

export default defineWorkflowTool({
  description: "Ask the student for several related details at once with a short form in the chat, then wait for the answers. Use it when a strategy needs two to five decisions before you can edit hero.bas, such as target priority, when to retreat, and whether to rush towers. For a single question use ask_question instead. Returns the values keyed by field name.",
  inputSchema: z.object({
    title: z.string().min(3).max(60).describe("Short heading for the form, such as Opening plan."),
    message: z.string().min(8).max(300).describe("One or two sentences on why you need these details."),
    fields: z.array(field).min(2).max(5),
  }),
  label: { start: ({ title }) => `Ask for details: ${title}` },
  async execute({ title, message, fields }, ctx) {
    "use workflow";
    const answer = await ctx.ask({ prompt: `${title}\n\n${message}`, display: "text", dismissible: true });
    if (answer.status !== "answered") return { status: answer.status };
    const text = answer.text ?? "";
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if (record.declined === true) return { status: "declined" as const };
      const values: Record<string, string> = {};
      for (const item of fields) {
        const value = record[item.name];
        if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") values[item.name] = String(value);
      }
      return { status: "answered" as const, values };
    }
    // The student answered in their own words in the composer instead of filling the form.
    return { status: "answered" as const, text };
  },
});
