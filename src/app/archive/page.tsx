import Link from "next/link";
import { redirect } from "next/navigation";
import { siteIdentity } from "@/lib/site";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Archive" };

/** The hub. Each cadence gets its own index page with a picker. */
export default async function ArchivePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  // old links carried ?date= straight to the snapshot listing
  if (date) redirect(`/archive/per-update?date=${date}`);
  const state = await loadState();
  const years = state.yearlyDigestYears ?? [];

  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>Archive</h1>
        <p>Everything {siteIdentity().siteName} has published, at every cadence.</p>
        <ul>
          <li>
            <Link href="/archive/daily">Daily</Link>: one page per UTC day, frozen at midnight.
          </li>
          <li>
            <Link href="/archive/weekly">Weekly</Link>: Saturday through Friday, frozen when the weekly edition goes
            out.
          </li>
          <li>
            <Link href="/archive/monthly">Monthly</Link>: the stories that defined each calendar month.
          </li>
          {years.map((y) => (
            <li key={y}>
              <Link href={`/year/${y}`}>{y} in review</Link>
            </li>
          ))}
          <li>
            <Link href="/archive/per-update">Per update</Link>: every front page, preserved each time the news
            changed.
          </li>
        </ul>
      </div>
    </main>
  );
}
