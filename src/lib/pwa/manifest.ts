import type { MetadataRoute } from 'next';
import type { Locale } from '@/lib/i18n/config';
import { localizePath } from '@/lib/i18n/routes';
import { translate } from '@/lib/i18n/translate';

export function comparisonManifest(locale: Locale): MetadataRoute.Manifest {
  return {
    id: '/', name: translate(locale, 'settings.installAppName'), short_name: 'riverz',
    description: translate(locale, 'settings.installAppDescription'), lang: locale,
    start_url: localizePath('/bandeja', locale), scope: '/', display: 'standalone',
    background_color: '#0a0a0a', theme_color: '#0a0a0a', prefer_related_applications: false,
    icons: [192, 512].map(size => ({ src: `/pwa/riverz-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })),
  };
}
