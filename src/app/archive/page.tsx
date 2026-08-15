import Link from "next/link";
import { DaySelect } from "@/components/DaySelect";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Archive" };

/** 250715-1430 → 14:30 UTC */
function timeLabel(id: string): string {
  return `${id.slice(7, 9)}:${id.slice(9, 11)} UTC`;
}

/** 250715-1430 → 2025-07-15 */
function dayOf(id: string): string {
  return `20${id.slice(0, 2)}-${id.slice(2, 4)}-${id.slice(4, 6)}`;
}

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function ArchivePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const state = await loadState();

  const byDay = new Map<string, string[]>();
  for (const id of [...state.snapshots].sort().reverse()) {
    const day = dayOf(id);
    const bucket = byDay.get(day);
    if (bucket) bucket.push(id);
    else byDay.set(day, [id]);
  }
  const days = [...byDay.keys()].sort().reverse();
  const selected = date && byDay.has(date) ? date : days[0];
  const shown = selected ? (byDay.get(selected) ?? []) : [];

  return (
    <main className="wrap page single">
      <div>
        <div className="section-head">
          <h1>Archive</h1>
          <p>Every front page, preserved each time the news changed. Times are UTC.</p>
          <DaySelect days={days} selected={selected} target="archive" />
        </div>
        {shown.length === 0 ? (
          <p className="empty-state">No snapshots yet.</p>
        ) : (
          <>
            <p className="status-line">{dayLabel(selected)}</p>
            <ul style={{ listStyle: "none" }}>
              {shown.map((id) => (
                <li key={id} className="river-item">
                  <Link href={`/${id}`}>{timeLabel(id)}</Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}
