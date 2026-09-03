import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgeStamp } from "@/components/AgeStamp";
import { sourceSlug } from "@/app/sources/shared";
import { isAdmin } from "@/lib/auth";
import { siteIdentity, writersPublic } from "@/lib/site";
import { loadState } from "@/lib/state";
import { writers } from "../shared";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const w = writers(await loadState()).get(slug);
  if (!w) return {};
  return {
    title: w.name,
    description: `Articles by ${w.name} that ${siteIdentity().siteName} published.`,
    ...(writersPublic() ? {} : { robots: { index: false } }),
  };
}

/** House style for this copy: no em dashes, no semicolons. */
export default async function WriterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!writersPublic() && !(await isAdmin())) notFound();
  const w = writers(await loadState()).get(slug);
  if (!w) notFound();
  const rows = w.articles.slice(0, 100);

  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>{w.name}</h1>
        <p>
          Everything by {w.name} that&apos;s on {siteIdentity().siteName}, writing for{" "}
          {w.outlets.map((o, i) => (
            <span key={o}>
              {i > 0 ? (i === w.outlets.length - 1 ? " and " : ", ") : ""}
              <Link href={`/sources/${sourceSlug(o)}`}>{o}</Link>
            </span>
          ))}
          . Each item links the story it appeared in. Bylines are read from the source feeds, so writers whose outlets
          leave the field empty are not listed. All writers are on <Link href="/by">one page</Link>.
        </p>
        <ul>
          {rows.map((r) => (
            <li key={r.url} className="newest-item">
              <a href={r.url} rel="noopener">
                {r.title}
              </a>
              <div className="org">
                {r.sourceName} · <AgeStamp iso={r.publishedAt} /> · in{" "}
                <Link href={`/story/${r.story.slug}`}>{r.story.headline}</Link>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
