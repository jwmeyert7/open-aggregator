import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  crons: [
    // The whole product: fetch → dedupe → LLM edit → merge → snapshot → bots.
    // Vercel sends Authorization: Bearer $CRON_SECRET automatically.
    { path: "/api/cron", schedule: "*/15 * * * *" },
  ],
};
