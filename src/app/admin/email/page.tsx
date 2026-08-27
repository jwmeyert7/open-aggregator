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
  const data: EmailData = {
    subscribers: chrome.subscribers,
    emailSubscribers: (state.digestSubscribers ?? []).map((s) => ({
      email: s.email,
      daily: s.daily,
      weekly: s.weekly,
      monthly: s.monthly ?? s.weekly,
      confirmed: s.confirmed !== false,
      addedAt: s.addedAt,
    })),
  };

  return (
    <main className="wrap page single admin">
      <EmailClient chrome={chrome} data={data} />
    </main>
  );
}
