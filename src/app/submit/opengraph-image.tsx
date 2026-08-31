import { brandCard, OG_SIZE } from "@/lib/og-brand";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Submit";

export default function Image() {
  return brandCard('Submit', 'Suggest a story or a source. Everything is reviewed by a human.', "submit");
}
