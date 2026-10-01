import { defineTool } from "eve/tools";
import { z } from "zod";
import { workspaceFile } from "../../lib/db";
import { requireStudent } from "../lib/student";

export default defineTool({
  description: "Open a text or BASIC file the student attached to chat. The file is restored inside /workspace/attachments. For a BASIC policy, compare with hero.bas and edit hero.bas before saving a revision. Never silently replace the saved policy.",
  inputSchema: z.object({ id: z.string().uuid(), type: z.enum(["policy", "text"]) }),
  label: { start: ({ type }) => `Read attached ${type === "policy" ? "policy" : "text"}` },
  async execute({ id, type }, ctx) {
    const student = requireStudent(ctx);
    const path = `attachments/${id}.${type === "policy" ? "bas" : "txt"}`;
    const file = await workspaceFile(student.subjectId, path);
    if (!file) throw new Error("This attachment is no longer available. Ask the student to attach it again.");
    await (await ctx.getSandbox()).writeTextFile({ path, content: file.content });
    return { path: `/workspace/${path}`, bytes: Buffer.byteLength(file.content, "utf8"), instruction: "Read this file in the sandbox. If it is a policy, make and save the student's requested change, then upload and request a hosted game." };
  },
});
