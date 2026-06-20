import { renderShareCard } from "@/components/og/share-card";

// X/Twitter card image (summary_large_image). Identical to the Open Graph card
// so the preview is consistent everywhere; most other platforms fall back to
// og:image, but X reads twitter:image first, so we emit it explicitly.

export const runtime = "edge";
export { alt, size, contentType } from "@/components/og/share-card";

export default function Image() {
  return renderShareCard();
}
