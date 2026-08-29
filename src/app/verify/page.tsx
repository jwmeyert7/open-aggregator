import Link from "next/link";
import { TamperDemo } from "@/components/TamperDemo";
import { siteIdentity } from "@/lib/site";
import { loadDailyDigest, loadState } from "@/lib/state";

export const metadata = {
  title: "Verify an edition",
  description: "Every frozen edition is sealed in public the day it is published. Here is how anyone can check one.",
};

export const dynamic = "force-dynamic";

/** The most recent day whose edition carries an onchain seal, for the live demo. */
async function latestAttestedDay(): Promise<{ date: string; uid: string } | null> {
  const state = await loadState();
  for (const date of (state.dailyDigestDates ?? []).slice(0, 10)) {
    const d = await loadDailyDigest(date);
    if (d && !d.inProgress && d.attestationUid) return { date, uid: d.attestationUid };
  }
  return null;
}

/** House style for this copy: no em dashes, no semicolons. */
export default async function VerifyPage() {
  const demo = await latestAttestedDay();
  const site = siteIdentity();
  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>Verify an edition</h1>
        <p>
          Each day&apos;s frozen edition gets a fingerprint (a sha256 hash) written the same day to a public record on
          Base that {site.siteName} cannot edit. If a past edition ever changed, the fingerprint would stop matching,
          and anyone could catch it.
        </p>

        <h2>The quick check</h2>
        <p>
          On any <Link href="/day">archived day</Link> that was hashed and attested to EAS, there will be a{" "}
          <em>verify this edition</em> button. That button asks your browser to recompute the fingerprint and compare
          it against the public record.
        </p>

        <h2>The full check, without trusting this site</h2>
        <ol>
          <li>
            Download the sealed file (<em>download the hashed json</em>, under the hash).
          </li>
          <li>
            Windows: <code>Get-FileHash edition-2026-08-28.json -Algorithm SHA256</code>
            <br />
            Mac or Linux: <code>shasum -a 256 edition-2026-08-28.json</code>
          </li>
          <li>Compare the output against the fingerprint in the onchain record.</li>
        </ol>
        <p>Hash the file exactly as downloaded. Re-saving it from an editor can change the bytes.</p>

        {demo ? (
          <>
            <h2>Or just try to break it</h2>
            <TamperDemo date={demo.date} uid={demo.uid} />
          </>
        ) : null}
      </div>
    </main>
  );
}
