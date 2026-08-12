import { runPipeline } from "./pipeline";
import { renderToFile } from "./render";

/**
 * Entry point. One command:
 *   run   fetch feeds, edit and cluster, save state, then render out/index.html
 */
async function main(): Promise<void> {
  const command = process.argv[2] ?? "run";

  if (command !== "run") {
    console.error(`Unknown command "${command}". Usage: tsx src/cli.ts run`);
    process.exit(1);
  }

  console.log("Running pipeline...");
  const report = await runPipeline();

  console.log("");
  console.log(`Feeds fetched:    ${report.fetchedFeeds}`);
  console.log(`New items:        ${report.newItems}`);
  console.log(`Rejected:         ${report.rejected}`);
  console.log(`Clusters created: ${report.clustersCreated}`);
  console.log(`Clusters updated: ${report.clustersUpdated}`);
  console.log(`Used LLM:         ${report.usedLlm ? "yes" : "no"}`);
  if (report.feedErrors.length > 0) {
    console.log(`Feed errors:      ${report.feedErrors.length}`);
    for (const e of report.feedErrors) console.log(`  - ${e.feedId}: ${e.error}`);
  }
  for (const note of report.notes) console.log(`Note: ${note}`);

  const outFile = renderToFile();
  console.log("");
  console.log(`Wrote ${outFile}`);
}

main().catch((err) => {
  console.error("Pipeline failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
