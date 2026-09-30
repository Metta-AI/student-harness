import type { NextConfig } from "next";
import { withEve } from "eve/next";

const config: NextConfig = {
  outputFileTracingIncludes: { "/*": ["./hero.bas"] },
};

// withEve boots the eve coach beside `next dev` and deploys it as a sibling Vercel service
// mounted at /eve/v1/*. The browser only ever talks to this origin.
export default withEve(config);
