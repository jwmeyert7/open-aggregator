import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // no generated AGENTS.md/CLAUDE.md clutter in the repo
  agentRules: false,
  // config/ is read from disk at runtime (identity, feeds, prompts, section
  // rules): make sure it ships inside the serverless bundle.
  outputFileTracingIncludes: {
    "/**": ["./config/**/*"],
  },
};

export default nextConfig;
