"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { wordFontWeight, type PlacedWord } from "@/lib/wordmap";

/**
 * The interactive layer of a word map: hovering any word underlines every
 * word that links the same story, so the cloud shows its groupings. Each
 * word carries its section's light and dark colors as inline CSS variables
 * (the sections are site config, so no static per-section classes exist),
 * and the stylesheet picks the pair apart by theme.
 */
export function WordmapCloud({
  cloud,
  canvas,
  colors,
}: {
  cloud: PlacedWord[];
  canvas: { w: number; h: number };
  colors: { light: Record<string, string>; dark: Record<string, string> };
}) {
  const [lit, setLit] = useState<string | null>(null);
  return (
    <>
      {cloud.map((w) => (
        <Link
          key={w.text}
          href={w.href || "#"}
          className={`wordmap-word${lit !== null && lit === w.href ? " lit" : ""}`}
          title={`${w.section} · weight ${w.weight}`}
          onMouseEnter={() => setLit(w.href)}
          onMouseLeave={() => setLit(null)}
          style={
            {
              left: `${(w.x / canvas.w) * 100}%`,
              top: `${(w.y / canvas.h) * 100}%`,
              fontSize: `${(w.size / canvas.w) * 100}cqw`,
              fontWeight: wordFontWeight(w.size),
              "--wm-light": colors.light[w.section] ?? colors.light.general,
              "--wm-dark": colors.dark[w.section] ?? colors.dark.general,
            } as CSSProperties
          }
        >
          {w.text}
        </Link>
      ))}
    </>
  );
}
