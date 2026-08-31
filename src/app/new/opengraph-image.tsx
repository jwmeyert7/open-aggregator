import { brandCard, OG_SIZE } from "@/lib/og-brand";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Newest";

export default function Image() {
  return brandCard('Newest', 'The newest stories and episodes on the site.', "new");
}
