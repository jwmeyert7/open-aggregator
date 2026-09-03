"use client";

import { useEffect, useState } from "react";
import { sealedRecord, sha256Hex } from "./VerifySeal";

/**
 * The break-the-seal demo: load a real sealed edition, let the reader edit
 * one headline in a scratch copy, and check the seal. Untouched, it
 * verifies. Change one letter and the check fails, which is the whole idea
 * of the seal experienced firsthand in ten seconds.
 */
export function TamperDemo({ date, uid }: { date: string; uid: string }) {
  const [original, setOriginal] = useState<string | null>(null);
  const [headline, setHeadline] = useState("");
  const [initialHeadline, setInitialHeadline] = useState("");
  const [state, setState] = useState<"idle" | "working" | "ok" | "bad" | "error">("idle");
  const [sealedAt, setSealedAt] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/day/${date}/edition.json`)
      .then((r) => r.text())
      .then((text) => {
        if (!alive) return;
        setOriginal(text);
        const first = (JSON.parse(text) as { clusters?: Array<{ headline?: string }> }).clusters?.[0]?.headline ?? "";
        setHeadline(first);
        setInitialHeadline(first);
      })
      .catch(() => setState("error"));
    return () => {
      alive = false;
    };
  }, [date]);

  const check = async () => {
    if (!original) return;
    setState("working");
    try {
      const record = await sealedRecord(uid);
      if (!record) {
        setState("error");
        return;
      }
      setSealedAt(record.sealedAt);
      const core = JSON.parse(original) as { clusters?: Array<{ headline?: string }> };
      if (core.clusters?.[0]) core.clusters[0].headline = headline;
      const recomputed = await sha256Hex(JSON.stringify(core));
      setState(recomputed === record.hash ? "ok" : "bad");
    } catch {
      setState("error");
    }
  };

  if (original === null && state === "error") {
    return <p className="verify-err">The demo could not load the sealed edition. The steps above still work.</p>;
  }

  return (
    <div className="tamper-demo">
      <p>
        Below is the real lead headline from the {date} edition. Leave it alone and the seal verifies. Change
        anything, one letter is enough, and watch the check fail.
      </p>
      <input
        className="text"
        type="text"
        value={headline}
        onChange={(e) => {
          setHeadline(e.target.value);
          setState("idle");
        }}
        aria-label="The edition's lead headline, editable for the demo"
      />
      <p>
        <button type="button" className="btn" onClick={check} disabled={state === "working" || original === null}>
          {state === "working" ? "checking…" : "check the seal"}
        </button>{" "}
        {headline !== initialHeadline ? (
          <button
            type="button"
            className="linklike"
            onClick={() => {
              setHeadline(initialHeadline);
              setState("idle");
            }}
          >
            restore the real headline
          </button>
        ) : null}
      </p>
      {state === "ok" ? (
        <p className="verify-ok">✓ Verified. Exactly what was sealed on {sealedAt}.</p>
      ) : null}
      {state === "bad" ? (
        <p className="verify-bad">✗ This content does not match the sealed record.</p>
      ) : null}
      {state === "error" ? <p className="verify-err">Could not reach the public record just now. The steps above work without it.</p> : null}
    </div>
  );
}
