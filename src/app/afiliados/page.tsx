import type { Metadata } from 'next';
import { AffiliatePage } from '@/components/affiliates/affiliate-page';
import { getLocale, getT } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  const locale = await getLocale();
  return {
    title: { absolute: t('affiliates.metaTitle') },
    description: t('affiliates.metaDescription'),
    alternates: {
      canonical: '/afiliados',
      languages: { es: '/afiliados', en: '/affiliates' },
    },
    openGraph: {
      type: 'website',
      siteName: 'riverz',
      url: locale === 'en' ? '/affiliates' : '/afiliados',
      title: t('affiliates.metaTitle'),
      description: t('affiliates.metaDescription'),
      images: [{ url: '/afiliados/hero.webp', width: 1672, height: 941 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('affiliates.metaTitle'),
      description: t('affiliates.metaDescription'),
      images: ['/afiliados/hero.webp'],
    },
  };
}

export default function AffiliatesPage() {
  return <AffiliatePage />;
}
