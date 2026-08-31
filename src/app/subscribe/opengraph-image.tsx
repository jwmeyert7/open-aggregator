import { brandCard, OG_SIZE } from "@/lib/og-brand";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Subscribe";

export default function Image() {
  return brandCard('Subscribe', 'The site by email: daily, weekly, or monthly editions, each one frozen and archived.', "subscribe");
}
