import Link from "next/link";
import { loadState } from "@/lib/state";
import { dayLabel, monthLabel, monthsWithDays } from "../dayList";

export const dynamic = "force-dynamic";

export const metadata = { title: "All days" };

/**
 * The full daily archive, one month per page. Paging walks only months that
 * have days, so a gap in publishing never produces an empty page. A static
 * /day/all segment takes precedence over /day/[date], so no date collides.
 */
export default async function AllDaysPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const state = await loadState();
  const months = monthsWithDays(state.dailyDigestDates ?? []);

  if (months.length === 0) {
    return (
      <main className="wrap page single roomy">
        <div className="prose">
          <h1>Daily archive</h1>
          <ul>
            <li className="org">No daily digests yet. The first one freezes at UTC midnight.</li>
          </ul>
        </div>
      </main>
    );
  }

  const index = Math.max(
    0,
    months.findIndex((m) => m.month === month)
  );
  const current = months[index];
  const newer = index > 0 ? months[index - 1] : undefined;
  const older = index < months.length - 1 ? months[index + 1] : undefined;

  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>{monthLabel(current.month)}</h1>
        <ul>
          {current.days.map((d) => (
            <li key={d}>
              <Link href={`/day/${d}`}>{dayLabel(d)}</Link>
            </li>
          ))}
        </ul>
        <div className="month-nav">
          <span>{newer ? <Link href={`/day/all?month=${newer.month}`}>← {monthLabel(newer.month)}</Link> : null}</span>
          <span>
            <Link href="/archive/daily">Recent days</Link>
          </span>
          <span>{older ? <Link href={`/day/all?month=${older.month}`}>{monthLabel(older.month)} →</Link> : null}</span>
        </div>
      </div>
    </main>
  );
}
