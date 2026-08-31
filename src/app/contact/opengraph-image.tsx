import { brandCard, OG_SIZE } from "@/lib/og-brand";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Contact";

export default function Image() {
  return brandCard('Contact', 'Get in touch.', "contact");
}
