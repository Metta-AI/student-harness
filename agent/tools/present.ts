import { defineTool } from "eve/tools";
import { presentToolSchema } from "../../lib/genui-library";

export default defineTool({
  description: "Show the student a small visual built from numbers you already read with other tools: a Chart of scores across revisions or episodes, a Table comparing revisions, seats, or league entries, or Facts for a single result. Pick a component with `component` and give its props inline; nest with `children`. Every number must come from a tool result in this conversation, each with its unit or what it is compared against. Never invent, estimate, or pad data, and do not call this when you have fewer than two real data points for a chart. The visual appears in the chat; your reply text should interpret it, not repeat it.",
  // A plain JSON Schema object: eve hands it to the model as written and validates input against it.
  inputSchema: presentToolSchema() as never,
  label: { start: () => "Draw a chart or table" },
  execute() {
    return { shown: true };
  },
});
