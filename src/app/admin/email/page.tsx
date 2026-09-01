import { EmailClient, type EmailData } from "./EmailClient";
import { buildChrome, NotLoggedIn } from "../server";
import { isAdmin } from "@/lib/auth";
import { loadSiteConfig } from "@/lib/config";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · Email", robots: { index: false } };

export default async function AdminEmailPage() {
  if (!(await isAdmin())) return <NotLoggedIn />;

  const state = await loadState();
  const cfg = loadSiteConfig();
  const chrome = buildChrome(state, cfg);
  // the newest send-report note per cadence, straight from the run log
  const sendHealth: Array<{ kind: string; at: string; note: string }> = [];
  for (const kind of ["daily", "weekly", "monthly"]) {
    for (const r of state.runLog ?? []) {
      const note = (r.notes ?? []).find((n) => n.startsWith(`${kind} email:`));
      if (note) {
        sendHealth.push({ kind, at: r.at, note });
        break;
      }
    }
  }
  const data: EmailData = {
    subscribers: chrome.subscribers,
    emailSubscribers: (state.digestSubscribers ?? []).map((s) => ({
      email: s.email,
      daily: s.daily,
      weekly: s.weekly,
      monthly: s.monthly === true,
      confirmed: s.confirmed !== false,
      addedAt: s.addedAt,
    })),
    sendHealth,
  };

  return (
    <main className="wrap page single admin">
      <EmailClient chrome={chrome} data={data} />
    </main>
  );
}
