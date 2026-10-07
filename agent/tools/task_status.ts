import { defineTool } from "eve/tools";
import { z } from "zod";
import { listTasks, controlTask } from "../../lib/tasks/store";
import { requireStudent } from "../lib/student";
export default defineTool({
  availableInSubagents: false,
  description: "List persistent tasks and worker results, or pause/resume/steer/cancel a task at the student's request. A resume can include the student's observation or clarification. Pause/cancel prevents new work; an already requested hosted game may finish.",
  inputSchema: z.object({ action: z.enum(["list", "pause", "resume", "steer", "cancel"]).default("list"), task_id: z.uuid().optional(), note: z.string().max(2000).default("") }),
  async execute({ action, task_id, note }, ctx) {
    const student = requireStudent(ctx);
    if (action === "list") return listTasks(student.subjectId);
    if (!task_id) throw new Error("task_id is required");
    return controlTask(student.subjectId, task_id, action, note);
  },
});
