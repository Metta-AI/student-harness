import { defineHook } from "eve/hooks";
import { studentFromAuth } from "../lib/student";
import { syncLabFiles } from "../lib/workspace";

/** After each turn, save the optimizer-seed lab and memory files so the next session starts from them. */
export default defineHook({
  events: {
    async "turn.completed"(_event, ctx) {
      const student = studentFromAuth(ctx.session.auth);
      if (!student) return;
      await syncLabFiles(await ctx.getSandbox(), student.subjectId);
    },
  },
});
