import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ClusterCard } from "@/components/ClusterCard";
import { loadState } from "@/lib/state";
import type { Cluster, SiteState } from "@/lib/types";

export const dynamic = "force-dynamic";

function findCluster(state: SiteState, slug: string): Cluster | undefined {
  const direct = Object.values(state.clusters).find((c) => c.slug === slug);
  if (direct) return direct;
  // slugs end in the cluster id, so edited-headline slugs still resolve
  const id = slug.split("-").pop();
  return id ? state.clusters[id] : undefined;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const cluster = findCluster(await loadState(), slug);
  if (!cluster) return {};
  return {
    title: cluster.headline,
    description: cluster.explainer
      ? cluster.explainer.charAt(0).toUpperCase() + cluster.explainer.slice(1)
      : undefined,
  };
}

export default async function StoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const state = await loadState();
  const cluster = findCluster(state, slug);
  if (!cluster) notFound();
  if (cluster.mergedInto && state.clusters[cluster.mergedInto]) {
    permanentRedirect(`/story/${state.clusters[cluster.mergedInto].slug}`);
  }
  if (cluster.killed) notFound();

  return (
    <main className="wrap page single">
      <div>
        <ClusterCard cluster={cluster} showSection />
        <p className="status-line">
          This permalink is the canonical link for this story. It updates as new coverage joins the cluster. Know a
          post that belongs here? <a href={`/submit?story=${cluster.slug}`}>Suggest a link</a>.
        </p>
      </div>
    </main>
  );
}
