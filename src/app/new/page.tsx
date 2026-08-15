import Link from "next/link";
import { AgeStamp } from "@/components/AgeStamp";
import { NewItemsButton } from "@/components/NewItemsButton";
import { byPublished, itemDisplayTitle } from "@/lib/rank";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Newest" };

/** Mobile home of the Newest rail: same compact look, more items. */
export default async function NewPage() {
  const state = await loadState();
  const items = byPublished(state.items)
    .slice(0, 40)
    .map((i) => ({ ...i, rawTitle: i.title, title: itemDisplayTitle(state, i) }));

  return (
    <main className="wrap page single">
      <div className="rail">
        <NewItemsButton latestId={state.items[0]?.id} />
        <h3>Newest</h3>
        <ul>
          {items.length === 0 ? <li className="org">Nothing yet.</li> : null}
          {items.map((i) => (
            <li key={i.id} className="newest-item">
              <a href={i.url} rel="noopener" title={i.rawTitle !== i.title ? `Source title: ${i.rawTitle}` : undefined}>
                {i.title}
              </a>
              <div className="org">
                {i.sourceName} · <AgeStamp iso={i.publishedAt} />
              </div>
            </li>
          ))}
        </ul>
        <div className="rail-more">
          <Link href="/stream">full stream →</Link>
        </div>
      </div>
    </main>
  );
}
