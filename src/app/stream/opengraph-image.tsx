import { brandCard, OG_SIZE } from "@/lib/og-brand";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Stream";

export default function Image() {
  return brandCard('Stream', 'Every accepted item as it lands, chronological and unranked.', "stream");
}
