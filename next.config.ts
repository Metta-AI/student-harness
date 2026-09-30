import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const config: NextConfig = {
  outputFileTracingIncludes: { "/*": ["./hero.bas"] },
};

export default withWorkflow(config);
