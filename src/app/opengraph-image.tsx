import { renderDealerShareCard } from '@/components/dealers/share-card';
export const runtime = 'nodejs';
export { alt, size, contentType } from '@/components/dealers/share-card';
export default function Image() {
  return renderDealerShareCard();
}
