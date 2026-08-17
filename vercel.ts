import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  crons: [
    // The whole product: fetch → dedupe → LLM edit → merge → snapshot → bots.
    // Vercel sends Authorization: Bearer $CRON_SECRET automatically.
    // The cadence is yours: faster means fresher and pairs well with the
    // prompt cache (runs inside each other's cache window read the editorial
    // rules at a tenth of the input price). Watch feed politeness and LLM
    // spend as you tighten it.
    { path: "/api/cron", schedule: "*/5 * * * *" },
  ],
};
