import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { translate } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';
const h = vi.hoisted(() => ({ enabled: false, locale: 'es' as Locale }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.enabled; } }));
vi.mock('@/hooks/use-locale', () => ({ useT: () => (key: string) => translate(h.locale, key) }));
vi.mock('./push-notifications',()=>({PushNotifications:()=>null}));
import { AppInstallation, AppInstallationCapture } from './app-installation';

it('renders no installation UI in the normal build', () => {
  h.enabled = false;
  expect(renderToStaticMarkup(<AppInstallation />)).toBe('');
  expect(renderToStaticMarkup(<AppInstallationCapture />)).toBe('');
});
it.each(['es', 'en'] as const)('offers localized manual help without claiming installation or notifications in %s', locale => {
  h.enabled = true; h.locale = locale;
  const html = renderToStaticMarkup(<AppInstallation />);
  expect(html).toContain(translate(locale, 'settings.installTitle'));
  expect(html).toContain(translate(locale, 'settings.installConnection'));
  expect(html).not.toContain(translate(locale, 'settings.installInstalled'));
  expect(html).not.toContain('<button');
});
