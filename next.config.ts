import type { NextConfig } from "next";
import { withEve } from "eve/next";

const config: NextConfig = {
  outputFileTracingIncludes: { "/*": ["./hero.bas"] },
  async rewrites() {
    return {
      // Serve Softmax's static replay viewer first-party so browsers that block third-party
      // frames (Brave Shields, strict tracking protection) still render replays. The host is
      // validated in /api/replay-session before a viewer URL is ever rewritten to this path.
      beforeFiles: [{ source: "/replay-viewer/:host/:path*", destination: "https://:host/:path*" }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default withEve(config);
