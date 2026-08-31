import { brandCard, OG_SIZE } from "@/lib/og-brand";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Archive";

export default function Image() {
  return brandCard('Archive', 'Every edition at every cadence: daily, weekly, monthly, and per-update.', "archive");
}
