import { defineTool } from "eve/tools";
import { presentationInputSchema } from "../../lib/workspace/presentation";
import { preparePresentation } from "../../lib/workspace/presentation-server";
import { requireStudent } from "../lib/student";
export default defineTool({
  description: "Show an existing GoTA view in a new workspace analysis tab. Use performance for official league MMR and recent results; strategy for policy branches; lab for inspecting sessions, workers, and research orchestration; experiments for shared test results (set experimentId to a hosted xreq ID for its hypothesis, policy, results and episodes); episodes for league rounds and practice replays; opponents for opponent policy research (opponentPolicyId selects a policy); development for the policy wiki: set wikiPage to overview, ontology, beliefs, source, versions, evidence or reference; use entityId for an ontology object (for example strategy:R_main). Use the current presentation.requestToken in client context. This never changes the human's tab or requires screen sharing. Prepare evidence when answering substantive questions; tell the user the analysis tab is available; do not claim they have read it. Prefer this over workspace_screen for ordinary navigation.",
  inputSchema: presentationInputSchema,
  async execute(input, ctx) { return preparePresentation(requireStudent(ctx).subjectId, input); },
});
