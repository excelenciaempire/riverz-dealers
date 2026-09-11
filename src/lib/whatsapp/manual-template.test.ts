import { describe, expect, it } from 'vitest';
import { dynamicUrlButtons, manualButtonValue, validBodyParams } from './manual-template';
import { dynamicButtonTemplateUrl } from './dynamic-links';

describe('manual template inputs', () => {
  it('detects synced cart buttons without private metadata and preserves their index', () => {
    expect(dynamicUrlButtons([{ type: 'QUICK_REPLY', text: 'Help' },
      { type: 'URL', text: 'Retomar compra', url: dynamicButtonTemplateUrl() }]))
      .toEqual([{ index: 1, text: 'Retomar compra', url: dynamicButtonTemplateUrl() }]);
    expect(dynamicUrlButtons([{ type: 'URL', url: 'https://example.com' }])).toEqual([]);
  });
  it('requires the real cart URL before generating a redirect token', () => {
    expect(manualButtonValue(dynamicButtonTemplateUrl(), 'https://shop.example/checkouts/customer-token'))
      .toEqual({ targetUrl: 'https://shop.example/checkouts/customer-token' });
    expect(() => manualButtonValue(dynamicButtonTemplateUrl(), '')).toThrow('templateLinkRequired');
  });
  it('rejects unsafe links and mismatched external button prefixes', () => {
    for (const url of ['javascript:alert(1)', 'not a url', 'https://user:password@example.com'])
      expect(() => manualButtonValue(dynamicButtonTemplateUrl(), url)).toThrow('templateLinkInvalid');
    expect(() => manualButtonValue('https://shop.example/orders/{{1}}', 'https://other.example/123'))
      .toThrow('templateLinkMismatch');
    expect(manualButtonValue('https://shop.example/orders/{{1}}', 'https://shop.example/orders/123'))
      .toEqual({ suffix: '123' });
  });
  it('rejects missing, empty, sparse or extra body parameters', () => {
    expect(validBodyParams('Hola {{1}}', ['Juan'])).toBe(true);
    for (const params of [[], [''], ['Juan', 'extra'], new Array(1), [42]])
      expect(validBodyParams('Hola {{1}}', params)).toBe(false);
    expect(validBodyParams('Hola', [])).toBe(true);
  });
});
