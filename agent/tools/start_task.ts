import { defineTool } from "eve/tools";
import { taskInputSchema } from "../../lib/tasks/model";
import { createTask } from "../../lib/tasks/store";
import { requireStudent } from "../lib/student";
export default defineTool({
  availableInSubagents: false,
  description: "Start a persistent background session, independent of this chat. Use kind=research for opponent semantic IR modeling, replay/episode analysis, league investigation, or other evidence research; these can run concurrently and do not change policies. Use kind=experiment to compare proposals, save a reviewed policy, upload and run one hosted game. Provide acceptance criteria and context policyId/episodeId/mode when relevant. Sessions appear in the left sidebar and continue with the browser closed. Delegate substantial work here, then keep chatting with the human.",
  inputSchema: taskInputSchema.omit({ requestKey: true }),
  async execute(input, ctx) {
    const student = requireStudent(ctx);
    return createTask(student.subjectId, { ...input, requestKey: `tool:${ctx.session.id}:${ctx.callId}` }, ctx.session.id);
  },
});
