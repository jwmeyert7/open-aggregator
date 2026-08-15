import Link from "next/link";
import { SubmitForm } from "./SubmitForm";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Suggest a link" };

export default async function SubmitPage({ searchParams }: { searchParams: Promise<{ story?: string }> }) {
  const { story } = await searchParams;
  const cluster = story ? Object.values((await loadState()).clusters).find((c) => c.slug === story && !c.killed) : undefined;

  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>Suggest a link</h1>
        {cluster ? (
          <p>
            Suggesting a link for: <Link href={`/story/${cluster.slug}`}>{cluster.headline}</Link>
          </p>
        ) : (
          <p>
            Found news we missed, or a post that adds a new perspective to a story? Send it here. Suggesting your own
            writing is fine as long as it adds something. Everything is reviewed by a human before it appears, and
            spam never will.
          </p>
        )}
        <SubmitForm story={cluster?.slug} />
      </div>
    </main>
  );
}
