import { defineDynamic } from "eve";
import { defineInstructions } from "eve/instructions";
import { studentFromAuth } from "../lib/student";
import { userPreferences } from "../../lib/preferences-store";
import { preferenceInstructions } from "../../lib/preferences";

export default defineDynamic({ events: {
  "turn.started": async (_event, ctx) => {
    const student = studentFromAuth(ctx.session.auth);
    if (!student) return null;
    try {
      return defineInstructions({ role: "user", content: preferenceInstructions(await userPreferences(student.subjectId)) });
    } catch { return null; }
  },
} });
