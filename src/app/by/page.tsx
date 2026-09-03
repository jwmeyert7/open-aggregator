import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { siteIdentity, writersPublic } from "@/lib/site";
import { loadState } from "@/lib/state";
import { writers } from "./shared";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Writers",
  description: `The writers behind the stories on ${siteIdentity().siteName}, with a page for each.`,
  ...(writersPublic() ? {} : { robots: { index: false } }),
};

/** House style for this copy: no em dashes, no semicolons. */
export default async function WritersPage() {
  if (!writersPublic() && !(await isAdmin())) notFound();
  const all = [...writers(await loadState()).values()].sort(
    (a, b) => b.articles.length - a.articles.length || a.name.localeCompare(b.name)
  );

  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>Writers</h1>
        {writersPublic() ? null : (
          <div className="archive-banner">Admin only for now. Visitors get a 404 here and nothing on the site links to it.</div>
        )}
        <p>
          Everyone with a byline on a current story, most published first. Bylines are read from the source feeds,
          so an outlet that leaves the field empty has no writers here. Outlets themselves are on{" "}
          <Link href="/sources">Sources</Link>.
        </p>
        {all.length === 0 ? (
          <p className="org">No bylines yet. They start accumulating with the next articles the pipeline reads.</p>
        ) : (
          <ul>
            {all.map((w) => (
              <li key={w.slug} className="newest-item">
                <Link href={`/by/${w.slug}`}>{w.name}</Link>
                <div className="org">
                  {w.outlets.join(", ")} · {w.articles.length} {w.articles.length === 1 ? "article" : "articles"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
