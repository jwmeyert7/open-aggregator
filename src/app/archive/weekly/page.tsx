import Link from "next/link";
import { WeekPickerJump } from "@/components/WeekPickerJump";
import { subjectRangeLabel } from "@/lib/digest";
import { loadState, loadWeeklyDigest } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Weekly archive" };

export default async function WeeklyArchivePage() {
  const state = await loadState();
  const ends = state.weeklyDigestDates ?? [];
  const weeks = (
    await Promise.all(
      ends.map(async (end) => {
        const d = await loadWeeklyDigest(end);
        return d ? { end, start: d.start, endDate: d.end, inProgress: d.inProgress } : null;
      })
    )
  ).filter((w) => w !== null);

  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>Weekly archive</h1>
        <p>
          One page per week, Saturday through Friday, frozen the moment the weekly edition goes out. You can{" "}
          <Link href="/subscribe">get these by email</Link> every Saturday.
        </p>
        <WeekPickerJump ends={ends} />
        <ul>
          {weeks.length === 0 ? <li className="org">No weekly editions yet. The first one freezes Saturday morning.</li> : null}
          {weeks.map((w) => (
            <li key={w.end}>
              <Link href={`/week/${w.end}`}>
                {subjectRangeLabel(new Date(`${w.start}T00:00:00Z`), new Date(`${w.endDate}T00:00:00Z`))}
              </Link>
              {w.inProgress ? (
                <span className="org">
                  {" "}
                  · <span className="live-dot" aria-hidden="true" />
                  in progress
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
