import { describe, expect, it, vi, afterEach } from 'vitest';
import { purchaseLines, purchaseLineSummary, purchasedVariantImage, purchaseConfirmationTemplates } from './purchase-confirmation';
import { buildTemplateComponents } from '@/lib/whatsapp/template-components';
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';

const white = 'https://cdn.shopify.com/white.jpg';
const black = 'https://cdn.shopify.com/black-white.jpg';
const product = { id: 100, variants: [{ id: 1, image_id: 10 }, { id: 2, image_id: 20 }, { id: 3 }],
  images: [{ id: 10, src: white, variant_ids: [1] }, { id: 20, src: black, variant_ids: [2] }] };
afterEach(() => vi.unstubAllGlobals());

describe('purchase confirmation', () => {
  it('matches the purchased variant instead of the first product photo', () => {
    expect(purchasedVariantImage({ product_id: '100', variant_id: '2' }, product)).toBe(black);
    expect(purchasedVariantImage({ product_id: 100, variant_id: 1 }, product)).toBe(white);
    expect(purchasedVariantImage({ product_id: 101, variant_id: 1 }, product)).toBeNull();
    expect(purchasedVariantImage({ product_id: 100, variant_id: 3 }, product)).toBeNull();
    expect(purchasedVariantImage({ product_id: 100, variant_id: 999 }, product)).toBeNull();
  });
  it('uses explicit image-to-variant links and rejects unrelated or unsafe images', () => {
    expect(purchasedVariantImage({ product_id: 100, variant_id: 2 }, { ...product, variants: [{ id: 2 }] })).toBe(black);
    expect(purchasedVariantImage({ product_id: 100, variant_id: 2 }, { ...product, images: [{ id: 20, src: 'http://localhost/image' }] })).toBeNull();
  });
  it('retains purchased quantities, variant and public personalization, never internal properties', () => {
    const line = { quantity: 2, title: 'Puma Suede XL', variant_title: 'Negro con blanco / 37',
      properties: [{ name: 'Detalle', value: 'Regalo' }, { name: '_internal', value: 'secret' }] };
    expect(purchaseLineSummary(line)).toBe('2 × Puma Suede XL (Negro con blanco / 37, Detalle: Regalo)');
    expect(purchaseLines(JSON.stringify([line]))).toEqual([line]);
    expect(purchaseLines('broken JSON')).toEqual([]);
    expect(purchaseLines([null, 1, 'x'])).toEqual([]);
  });
  it.each(['es', 'en'] as const)('validates all approved-body shapes in %s', language => {
    for (const item of purchaseConfirmationTemplates(language)) {
      expect(buildTemplateComponents({ category: 'UTILITY', headerType: item.headerType,
        headerHandle: item.headerType === 'image' ? 'sample-handle' : undefined,
        bodyText: item.body, bodySamples: item.samples, buttons: item.buttons }).error).toBeNull();
      expect(item.fields).toHaveLength(item.samples.length);
      expect([...item.body.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1])))
        .toEqual(item.fields.map((_, i) => i + 1));
      expect(item.samples.every(s => !/[\r\n\t]/.test(s))).toBe(true);
    }
    expect(purchaseConfirmationTemplates(language).find(t => t.name.includes('_2_'))!.body).toContain('• {{2}}\n• {{3}}');
  });
  it('sends the real image as a template header while preserving body and button parameters', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.photo' }] })));
    vi.stubGlobal('fetch', fetchMock);
    await sendTemplateMessage({ phoneNumberId: 'phone-id', accessToken: 'test', to: '573000000000',
      templateName: 'photo', language: 'es', params: ['1 × Puma (Negro / 37)'], headerImageUrl: black,
      buttonUrlParam: 'token' });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.template.components).toEqual([
      { type: 'header', parameters: [{ type: 'image', image: { link: black } }] },
      { type: 'body', parameters: [{ type: 'text', text: '1 × Puma (Negro / 37)' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'token' }] },
    ]);
  });
});
