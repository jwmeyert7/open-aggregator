import Link from "next/link";
import { StreamList, type StreamItem } from "./StreamList";
import { byPublished, itemDisplayTitle } from "@/lib/rank";
import { loadState } from "@/lib/state";
import { mediaThumb } from "@/lib/util";

export const dynamic = "force-dynamic";

export const metadata = { title: "Stream" };

export default async function StreamPage() {
  const state = await loadState();
  const episodes: StreamItem[] = (state.mediaItems ?? [])
    .filter((m) => !m.hidden)
    .map((m) => ({
      id: `ep-${m.id}`,
      url: m.videoUrl ?? m.url,
      title: m.displayTitle ?? m.title,
      ...(m.displayTitle ? { rawTitle: m.title } : {}),
      sourceName: m.sourceName,
      publishedAt: m.publishedAt,
      podcast: true,
      playHref: `/podcasts?play=${m.id}#m-${m.id}`,
      ...(m.section ? { section: m.section } : {}),
      ...(m.views ? { views: m.views } : {}),
      episode: {
        id: m.id,
        url: m.url,
        kind: m.kind,
        title: m.title,
        ...(mediaThumb(m) ? { thumbnail: mediaThumb(m) } : {}),
        ...(m.audioUrl ? { audioUrl: m.audioUrl } : {}),
        ...(m.videoUrl ? { videoUrl: m.videoUrl } : {}),
      },
    }));
  const items: StreamItem[] = byPublished(state.items)
    .slice(0, 300)
    .map((i): StreamItem => {
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
    })
    // episodes join at their publish time: the Stream is the one chronological view
    .concat(episodes)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 300);

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
