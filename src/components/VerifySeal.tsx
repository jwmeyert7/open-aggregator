"use client";

import { useState } from "react";

/** Browser-native sha256 of a string, hex. The same math as the freeze-time hasher. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The sealed hash and seal time for an attestation, read from EAS's public index (not from this site). */
export async function sealedRecord(uid: string): Promise<{ hash: string; sealedAt: string } | null> {
  const res = await fetch("https://base.easscan.org/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "query($id:String!){ attestation(where:{id:$id}){ decodedDataJson timeCreated } }",
      variables: { id: uid },
    }),
  });
  const att = (await res.json())?.data?.attestation;
  if (!att) return null;
  const decoded = JSON.parse(att.decodedDataJson) as Array<{ name: string; value: { value: unknown } }>;
  const hash = String(decoded.find((d) => d.name === "contentHash")?.value?.value ?? "").replace(/^0x/, "");
  if (!hash) return null;
  // "29 Aug 2026 18:50:30 UTC": comma-free and exact to the second
  const [, day, month, year, time] = new Date(att.timeCreated * 1000).toUTCString().split(" ");
  return { hash, sealedAt: `${Number(day)} ${month} ${year} ${time} UTC` };
}

/**
 * One-click verification: re-hash the frozen edition in THIS browser and
 * compare against the seal on Base, read via EAS's public index rather than
 * anything this site stores. The reader sees a check mark and a sentence; the
 * math underneath is the real thing, inspectable in devtools.
 */
export function VerifySeal({ date, uid }: { date: string; uid: string }) {
  const [state, setState] = useState<"idle" | "working" | "ok" | "bad" | "error">("idle");
  const [detail, setDetail] = useState("");
  const [work, setWork] = useState<string[]>([]);
  const [showWork, setShowWork] = useState(false);

  const run = async () => {
    setState("working");
    setDetail("");
    const runNumber = work.filter((l) => l.startsWith("run ")).length + 1;
    const lines: string[] = [`run ${runNumber} · ${new Date().toUTCString().slice(17, 25)} UTC`];
    const finish = () => setWork((prev) => [...prev, ...lines]);
    try {
      const [fileText, record] = await Promise.all([
        fetch(`/day/${date}/edition.json`).then((r) => r.text()),
        sealedRecord(uid),
      ]);
      lines.push(`fetched /day/${date}/edition.json · ${new TextEncoder().encode(fileText).length} bytes`);
      if (!record) {
        lines.push("could not reach base.easscan.org for the sealed hash");
        finish();
        setState("error");
        setDetail("Could not reach the public record. The do-it-yourself steps on /verify work without it.");
        return;
      }
      const recomputed = await sha256Hex(fileText);
      lines.push(`sha256 of those bytes in this browser: ${recomputed}`);
      lines.push(`sealed hash read from base.easscan.org: ${record.hash}`);
      lines.push(recomputed === record.hash ? "compare: match" : "compare: MISMATCH");
      finish();
      if (recomputed === record.hash) {
        setState("ok");
        setDetail(`Unchanged since it was sealed in public on ${record.sealedAt}.`);
      } else {
        setState("bad");
        setDetail("This content does not match the sealed record. Either the edition changed after sealing or the tooling has a bug. Use the do-it-yourself steps on /verify to confirm independently.");
      }
    } catch {
      lines.push("something failed before the comparison");
      finish();
      setState("error");
      setDetail("Something failed while checking. The do-it-yourself steps on /verify work without this button.");
    }
  };

  const seal = (
    <svg
      className="seal-icon"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
    </svg>
  );
  return (
    <span className={`verify-seal${state === "ok" ? " sealed" : ""}`}>
      {state === "ok" ? (
        <button type="button" className="linklike verify-ok" onClick={run} title="Verify again">
          {seal} Verified. {detail}
        </button>
      ) : (
        <button type="button" className="linklike" onClick={run} disabled={state === "working"}>
          {seal} {state === "working" ? "checking…" : "verify this edition"}
        </button>
      )}{" "}
      <a href="/verify" className="verify-help" title="How verification works">
        ?
      </a>
      {work.length > 0 ? (
        <>
          {" "}
          <button
            type="button"
            className="linklike verify-work-toggle"
            onClick={() => setShowWork((s) => !s)}
            title="The steps each verify run took, newest last"
          >
            {showWork ? "hide the work ▴" : "show the work ▾"}
          </button>
        </>
      ) : null}
      {state === "bad" ? <span className="verify-bad"> ✗ {detail}</span> : null}
      {state === "error" ? <span className="verify-err"> {detail}</span> : null}
      {showWork && work.length > 0 ? (
        <span className="verify-steps">
          {work.map((line, i) => (
            <span key={i} className={`verify-step${line.startsWith("run ") ? " run" : ""}`}>
              {line}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}
