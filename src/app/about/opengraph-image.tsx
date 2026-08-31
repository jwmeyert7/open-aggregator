import { brandCard, OG_SIZE } from "@/lib/og-brand";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "About";

export default function Image() {
  return brandCard('About', 'An auto-updating, self-hosted news front page.', "about");
}
