import { defineTool } from "eve/tools";
import { webFetch } from "eve/tools/web_fetch";

const allowedHosts = /^(?:softmax\.com|docs\.softmax\.com|github\.com|raw\.githubusercontent\.com)$/;
const replayLike = /\.(?:replay|zip|tar|gz|mp4|webm|bin)(?:$|\?)/i;

/** Fetch only Softmax documentation, the wiki API, and the optimizer-seed repository. Never replay or archive files. */
export default defineTool({
  ...webFetch,
  description: "Fetch a Softmax wiki, docs, or league page as markdown (softmax.com, docs.softmax.com) or a file from the Metta-AI/optimizer-seed repository on GitHub. Replay files, archives, and other hosts are refused.",
  execute(input, ctx) {
    const url = new URL(input.url);
    if (url.protocol !== "https:" || !allowedHosts.test(url.hostname)) {
      throw new Error(`web_fetch only reaches softmax.com, docs.softmax.com, and github.com. Refused: ${url.hostname}`);
    }
    if (replayLike.test(url.pathname) || /\/replays?\//i.test(url.pathname)) {
      throw new Error("Replay and archive downloads are not allowed. Read hosted results with hosted_game_status or coworld episode-stats instead.");
    }
    if (url.hostname.endsWith("github.com") && !/^\/Metta-AI\/optimizer-seed\b/i.test(url.pathname)) {
      throw new Error("Only the Metta-AI/optimizer-seed repository may be fetched from GitHub.");
    }
    return webFetch.execute(input, ctx);
  },
});
