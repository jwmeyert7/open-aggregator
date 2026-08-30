import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Fonts and text helpers for the social cards. The site renders in the OS
 * system font stack (Segoe UI on Windows), which Satori cannot use, so the
 * cards load Selawik, Microsoft's open-licensed Segoe UI companion, and the
 * wordmark on a card matches the wordmark on the site.
 */
export function ogFonts(): Array<{ name: string; data: Buffer; weight: 400 | 600 | 700; style: "normal" }> {
  const dir = join(process.cwd(), "config", "fonts");
  return [
    { name: "Selawik", data: readFileSync(join(dir, "selawk.ttf")), weight: 400, style: "normal" },
    { name: "Selawik", data: readFileSync(join(dir, "selawksb.ttf")), weight: 600, style: "normal" },
    { name: "Selawik", data: readFileSync(join(dir, "selawkb.ttf")), weight: 700, style: "normal" },
  ];
}

/**
 * The word map's own face: Pixelify Sans (OFL), the blocky construction the
 * cloud renders in on the page, so the PNG artwork matches pixel for pixel.
 */
export function wordmapFonts(): Array<{ name: string; data: Buffer; weight: 500 | 600 | 700; style: "normal" }> {
  const dir = join(process.cwd(), "config", "fonts");
  return [
    { name: "Pixelify Sans", data: readFileSync(join(dir, "pixelify-500.ttf")), weight: 500, style: "normal" },
    { name: "Pixelify Sans", data: readFileSync(join(dir, "pixelify-600.ttf")), weight: 600, style: "normal" },
    { name: "Pixelify Sans", data: readFileSync(join(dir, "pixelify-700.ttf")), weight: 700, style: "normal" },
  ];
}

/** Cut at a word boundary, never mid-word, with the ellipsis outside the cut. */
export function ogTruncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > max * 0.6 ? space : max).trimEnd()}…`;
}
