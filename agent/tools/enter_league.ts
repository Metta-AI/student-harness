import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { trackServer } from "../../lib/analytics-server";
import { events } from "../../lib/analytics-events";
import { latestPolicyVersion, policyVersionByRevision } from "../../lib/db";
import { submitPolicy } from "../../lib/softmax";
import { requireStudentToken } from "../lib/student";

export default defineTool({
  description: "Submit an uploaded revision to the live Gods of the Arena league. Only when the student explicitly asks to enter the league. The student approves the submission in the chat before it runs.",
  inputSchema: z.object({ revision: z.number().int().positive().optional().describe("Saved revision number. Omit for the latest uploaded revision.") }),
  approval: always(),
  label: { start: ({ revision }) => `Enter the league with revision ${revision ?? "latest"}` },
  async execute({ revision }, ctx) {
    const student = await requireStudentToken(ctx);
    const version = revision === undefined ? await latestPolicyVersion(student.subjectId) : await policyVersionByRevision(student.subjectId, revision);
    if (!version?.softmax_policy_version_id) throw new Error("Upload the revision with upload_policy before entering the league.");
    const submission = await submitPolicy(student.token, version.softmax_policy_version_id);
    await trackServer(student.subjectId, events.leagueEntered, { source: "agent", revision: version.revision_number, status: submission.status }, { league_entered: true });
    return { revision: version.revision_number, policy_label: version.softmax_policy_label, submission_id: submission.id, status: submission.status };
  },
});
