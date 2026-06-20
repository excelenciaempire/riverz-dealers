import { renderShareCard } from "@/components/og/share-card";

// Site-wide Open Graph image. Next auto-injects og:image / og:image:width /
// og:image:height / og:image:alt into <head> for every route that doesn't
// override it. Resolves to https://riverz.co/opengraph-image (absolute via the
// metadataBase set in layout.tsx). The card itself lives in the shared module.

export const runtime = "edge";
export { alt, size, contentType } from "@/components/og/share-card";

export default function Image() {
  return renderShareCard();
}
