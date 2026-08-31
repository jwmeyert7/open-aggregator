import { brandCard, OG_SIZE } from "@/lib/og-brand";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Criteria";

export default function Image() {
  return brandCard('Criteria', 'What gets a story or a source onto the site.', "criteria");
}
