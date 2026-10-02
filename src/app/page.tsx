import type { Metadata } from 'next';
import { DealerLanding } from '@/components/dealers/dealer-landing';
import { getT } from '@/lib/i18n/server';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { absolute: t('dealers.brand') },
    description: t('dealers.heroText'),
    openGraph: {
      title: t('dealers.brand'),
      description: t('dealers.heroText'),
      siteName: t('dealers.brand'),
    },
    twitter: { title: t('dealers.brand'), description: t('dealers.heroText') },
  };
}
export default function RootPage() {
  return <DealerLanding />;
}
