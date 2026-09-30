import { defineSandbox, type SandboxSession } from "eve/sandbox";
import { VercelSandbox } from "eve/sandbox/vercel";
import coworldShim from "./scripts/coworld-shim.sh?raw";
import softmaxShim from "./scripts/softmax-shim.sh?raw";
import { studentToken } from "../../lib/db";
import { studentFromAuth } from "../lib/student";
import { hydrateWorkspace, LAB_DIR, SEED_BRANCH, SEED_DIR, SEED_REPO } from "../lib/workspace";

const COWORLD_VERSION = "0.1.55";
const UPLOAD_BUCKET = "observatory-private.s3.amazonaws.com";

async function sh(sandbox: SandboxSession, command: string) {
  const result = await sandbox.run({ command });
  if (result.exitCode !== 0) throw new Error(`${command}\n${result.stderr || result.stdout}`.slice(0, 4000));
  return result.stdout;
}

/**
 * Snapshot prepared once per build: git, uv with a pinned coworld CLI hidden behind an
 * allowlisting shim, and the optimizer-seed repository with a Gods of the Arena lab.
 * The sandbox never has Docker and never downloads replays: the shim refuses those commands
 * and the session network policy only reaches softmax.com and the policy upload bucket.
 */
export const environment = VercelSandbox.environment({
  prepare: async (sandbox) => {
    await sh(sandbox, "git --version && mkdir -p /workspace/versions /workspace/experiments");
    await sh(sandbox, "curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/opt/uv INSTALLER_NO_MODIFY_PATH=1 sudo -E sh");
    await sh(sandbox, `sudo mkdir -p /opt/coworld-bin && sudo env UV_TOOL_BIN_DIR=/opt/coworld-bin UV_TOOL_DIR=/opt/coworld-tools UV_PYTHON_INSTALL_DIR=/opt/uv-python UV_CACHE_DIR=/opt/uv-cache /opt/uv/uv tool install --python 3.12 "coworld[auth]==${COWORLD_VERSION}" && sudo chmod -R a+rX /opt/coworld-tools /opt/uv-python`);
    await sandbox.writeTextFile({ path: "/tmp/coworld-shim.sh", content: coworldShim });
    await sandbox.writeTextFile({ path: "/tmp/softmax-shim.sh", content: softmaxShim });
    await sh(sandbox, "sudo install -m 0755 /tmp/coworld-shim.sh /usr/local/bin/coworld && sudo install -m 0755 /tmp/softmax-shim.sh /usr/local/bin/softmax && sudo chmod 0755 /opt/coworld-bin && rm /tmp/*-shim.sh");
    // The real token never enters the sandbox: the network policy swaps this placeholder at the boundary.
    await sh(sandbox, `mkdir -p "$HOME/.softmax" && printf 'tokens:\\n  https://softmax.com/api: arena-sandbox-placeholder\\n' > "$HOME/.softmax/credentials.yaml" && chmod 600 "$HOME/.softmax/credentials.yaml"`);
    await sh(sandbox, `git clone --depth 1 --branch ${SEED_BRANCH} ${SEED_REPO} ${SEED_DIR} && cp -r ${SEED_DIR}/games/_template ${LAB_DIR} && cp /workspace/docs/*.md ${LAB_DIR}/docs/ 2>/dev/null || true`);
    await sh(sandbox, "PATH=/usr/local/bin:$PATH; coworld --help >/dev/null && softmax --help >/dev/null && ! coworld download 2>/dev/null");
  },
});

export default defineSandbox(async ({ session }) => {
  const student = studentFromAuth(session.auth);
  const token = student ? await studentToken(student.subjectId) : null;
  const sandbox = await environment.open({
    resources: { vcpus: 1 },
    networkPolicy: token ? {
      allow: {
        "softmax.com": [{ transform: [{ headers: { authorization: `Bearer ${token}` } }] }],
        [UPLOAD_BUCKET]: [],
      },
    } : "deny-all",
  });
  await hydrateWorkspace(sandbox, student?.subjectId ?? null);
  return sandbox;
});
