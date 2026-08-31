import { brandCard, OG_SIZE } from "@/lib/og-brand";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Sources";

export default function Image() {
  return brandCard('Sources', 'The hand-picked whitelist the site reads: team blogs, forums, primary sources, podcasts, and news outlets.', "sources");
}
