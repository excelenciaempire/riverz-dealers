import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { comparisonManifest } from './manifest';
const h = vi.hoisted(() => ({ enabled: false, locale: 'es', read: vi.fn() }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.enabled; } }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => { h.read(); return h.locale; } }));
import manifest from '@/app/manifest';

describe('mobile manifest reserved for comparison', () => {
  it('preserves the current manifest in production without reading request cookies', async () => {
    h.enabled = false; h.read.mockClear();
    const current = await manifest();
    expect(current.start_url).toBe('/'); expect(current.lang).toBe('es');
    expect(current.icons?.map(icon => icon.src)).toEqual(['/icon', '/apple-icon']);
    expect(h.read).not.toHaveBeenCalled();
  });
  it.each(['es', 'en'] as const)('uses the localized authenticated inbox and stable app identity in %s', async locale => {
    h.enabled = true; h.locale = locale;
    const current = await manifest();
    expect(current).toEqual(comparisonManifest(locale));
    expect(current.id).toBe('/'); expect(current.scope).toBe('/');
    expect(current.start_url).toBe(locale === 'es' ? '/bandeja' : '/inbox');
    expect(current.icons?.map(icon => icon.sizes)).toEqual(['192x192', '512x512']);
    expect(current.shortcuts).toBeUndefined(); // No private case, customer or approval in a public manifest.
  });
  it.each([192, 512])('ships an opaque brand PNG with the declared %ipx dimensions', async size => {
    const image = sharp(`public/pwa/riverz-${size}.png`);
    const meta = await image.metadata();
    expect(meta.format).toBe('png'); expect(meta.width).toBe(size); expect(meta.height).toBe(size);
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([10, 10, 10]);
    if (info.channels === 4) expect(data.filter((_, i) => i % 4 === 3).every(alpha => alpha === 255)).toBe(true);
  });
});
