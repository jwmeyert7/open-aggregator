import { RunsClient, type RunsData } from "./RunsClient";
import { buildChrome, NotLoggedIn } from "../server";
import { isAdmin } from "@/lib/auth";
import { loadSiteConfig } from "@/lib/config";
import { loadDailyDigest, loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · Runs", robots: { index: false } };

export default async function AdminRunsPage() {
  if (!(await isAdmin())) return <NotLoggedIn />;

  const state = await loadState();
  const cfg = loadSiteConfig();
  const data: RunsData = {
    runs: state.runLog ?? [],
    frontSummary: state.frontSummary?.text ?? "",
    frontSummaryAt: state.frontSummary?.at ?? null,
    exampleSection: cfg.sections[0]?.id ?? "general",
    digests: await Promise.all(
      (state.dailyDigestDates ?? []).slice(0, 7).map(async (d) => {
        const dg = await loadDailyDigest(d);
        return {
          date: d,
          stories: dg?.clusters.length ?? 0,
          cast: Boolean(dg?.castHash),
          tweetId: dg?.tweetId ?? null,
        };
      })
    ),
  };

  return (
    <main className="wrap page single admin">
      <RunsClient chrome={buildChrome(state, cfg)} data={data} />
    </main>
  );
}
