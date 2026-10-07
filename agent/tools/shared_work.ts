import { defineTool } from "eve/tools";
import { z } from "zod";
import { claimInputSchema, responseSchema } from "../../lib/partner/model";
import { createClaim, readPartner, respondToClaim } from "../../lib/partner/store";
import { requireStudent } from "../lib/student";

export default defineTool({
  availableInSubagents: false,
  description: "Read our GoTA hypotheses, disagreements and working lessons; propose a claim or record Preston's own stance with a reason and evidence. You cannot set the human's stance. Agreement is not proof. Claims require a situation, behavior, expected outcome and falsifier. Lessons agreed by both participants are recalled on subsequent chat turns.",
  inputSchema: z.object({ action: z.enum(["list", "propose", "respond"]), claim: claimInputSchema.optional(), response: responseSchema.optional() }),
  label: { start: ({ action }) => action === "list" ? "Read our shared work" : "Update Preston’s position" },
  async execute({ action, claim, response }, ctx) {
    const { subjectId } = requireStudent(ctx);
    if (action === "list") return readPartner(subjectId);
    if (action === "propose" && claim) return createClaim(subjectId, claim, "present");
    if (action === "respond" && response) return respondToClaim(subjectId, response, "present");
    throw new Error("Provide claim for propose, or response for respond.");
  },
});
