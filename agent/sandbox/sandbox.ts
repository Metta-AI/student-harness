import { defineSandbox } from "eve/sandbox";
import { VercelSandbox } from "eve/sandbox/vercel";
import { studentFromAuth } from "../lib/student";
import { hydrateWorkspace } from "../lib/workspace";

/**
 * One Vercel Sandbox per chat session, created from a prepared snapshot. The sandbox has no
 * network: Softmax access goes through tools in the app runtime, so the student's token
 * never enters model-controlled compute.
 */
export const environment = VercelSandbox.environment({
  prepare: async (sandbox) => {
    const result = await sandbox.run({ command: "git --version && mkdir -p /workspace/versions /workspace/experiments" });
    if (result.exitCode !== 0) throw new Error(result.stderr);
  },
});

export default defineSandbox(async ({ session }) => {
  const sandbox = await environment.open({ networkPolicy: "deny-all", resources: { vcpus: 1 } });
  await hydrateWorkspace(sandbox, studentFromAuth(session.auth)?.subjectId ?? null);
  return sandbox;
});
