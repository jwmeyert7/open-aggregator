import Link from "next/link";
import { MonthPickerJump } from "@/components/MonthPickerJump";
import { loadMonthlyDigest, loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Monthly archive" };

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

export default async function MonthlyArchivePage() {
  const state = await loadState();
  const keys = state.monthlyDigestMonths ?? [];
  const months = (
    await Promise.all(
      keys.map(async (month) => {
        const d = await loadMonthlyDigest(month);
        return d ? { month, inProgress: d.inProgress } : null;
      })
    )
  ).filter((m) => m !== null);

  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>Monthly archive</h1>
        <p>
          One page per calendar month: the stories that defined it, frozen when the month closes. You can{" "}
          <Link href="/subscribe">get these by email</Link> too.
        </p>
        <MonthPickerJump months={keys} />
        <ul>
          {months.length === 0 ? <li className="org">No monthly editions yet. The first one freezes when the month ends.</li> : null}
          {months.map((m) => (
            <li key={m.month}>
              <Link href={`/month/${m.month}`}>{monthLabel(m.month)}</Link>
              {m.inProgress ? (
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
