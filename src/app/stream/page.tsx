import Link from "next/link";
import { StreamList, type StreamItem } from "./StreamList";
import { byPublished, itemDisplayTitle } from "@/lib/rank";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Stream" };

export default async function StreamPage() {
  const state = await loadState();
  const items: StreamItem[] = byPublished(state.items)
    .slice(0, 300)
    .map((i) => {
      const cluster = i.clusterId ? state.clusters[i.clusterId] : undefined;
      const title = itemDisplayTitle(state, i);
      return {
        id: i.id,
        url: i.url,
        title,
        ...(title !== i.title ? { rawTitle: i.title } : {}),
        sourceName: i.sourceName,
        publishedAt: i.publishedAt,
        ...(cluster && !cluster.killed ? { storySlug: cluster.slug, section: cluster.section } : {}),
      };
    });

  return (
    <main className="wrap page single">
      <div>
        <div className="section-head">
          <h1>Stream</h1>
          <p>
            The raw firehose: every ingested item in reverse-chronological order, before clustering or curation. Times
            are shown in your local timezone. The curated view is the <Link href="/">front page</Link>.
          </p>
        </div>
        {items.length === 0 ? <p className="empty-state">Nothing ingested yet.</p> : null}
        <StreamList items={items} />
      </div>
    </main>
  );
}
