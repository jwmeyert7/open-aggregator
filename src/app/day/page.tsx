import Link from "next/link";
import { DayPickerJump } from "@/components/DayPickerJump";
import { loadState } from "@/lib/state";
import { utcDay } from "@/lib/util";
import { dayLabel, RECENT_DAYS } from "./dayList";

export const dynamic = "force-dynamic";

export const metadata = { title: "Daily archive" };

export default async function DayIndexPage() {
  const state = await loadState();
  const dates = state.dailyDigestDates ?? [];
  const recent = dates.slice(0, RECENT_DAYS);

  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>Daily archive</h1>
        <p>
          One page per UTC day: the best curation of that day, frozen at midnight. For the rolling history of front
          pages, click the date, block, or slot in the header, or browse the{" "}
          <Link href="/archive">snapshot archive</Link>. You can also{" "}
          <Link href="/subscribe">get these pages by email</Link>, daily or as a Saturday weekly.
        </p>
        <DayPickerJump days={dates} />
        <ul>
          {recent.length === 0 ? <li className="org">No daily digests yet. The first one freezes at UTC midnight.</li> : null}
          {recent.map((d) => (
            <li key={d}>
              <Link href={`/day/${d}`}>{dayLabel(d)}</Link>
              {d === utcDay(new Date().toISOString()) ? (
                <span className="org">
                  {" "}
                  · <span className="live-dot" aria-hidden="true" />
                  in progress
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {dates.length > RECENT_DAYS ? (
          <p>
            <Link href="/day/all">View all days</Link>
          </p>
        ) : null}
      </div>
    </main>
  );
}
