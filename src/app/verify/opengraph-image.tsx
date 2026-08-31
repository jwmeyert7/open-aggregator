import { brandCard, OG_SIZE } from "@/lib/og-brand";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Verify an edition";

export default function Image() {
  return brandCard('Verify an edition', 'Check any frozen edition against its onchain seal, in your browser or on your own.', "verify");
}
