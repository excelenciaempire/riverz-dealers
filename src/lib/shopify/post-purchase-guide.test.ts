import { describe, it, expect } from 'vitest';
import {
  qualifiesForGuide,
  guideRecipient,
  guideMessageId,
  guideEmailRaw,
  guideSendFailure,
  type GuideOrder,
} from './post-purchase-guide';
const rule = {
  guide_product_id: 'gift',
  qualifying_product_id: 'shampoo',
  minimum_quantity: 3,
  enabled_at: '2026-10-01T15:00:00Z',
};
const order = (qty = 3): GuideOrder => ({
  id: 1,
  created_at: '2026-10-01T15:01:00Z',
  financial_status: 'paid',
  email: 'ana@example.com',
  line_items: [
    { product_id: 'shampoo', quantity: qty },
    { product_id: 'gift', quantity: 1 },
  ],
});
describe('post-purchase guide eligibility', () => {
  it.each([3, 10])('includes the paid %i-bottle pack', (qty) =>
    expect(qualifiesForGuide(order(qty), rule)).toBe(true)
  );
  it.each([1, 2])('excludes a %i-bottle purchase', (qty) =>
    expect(qualifiesForGuide(order(qty), rule)).toBe(false)
  );
  it('requires the gift and the correct product, never price or title guesses', () => {
    const o = order();
    o.line_items.pop();
    expect(qualifiesForGuide(o, rule)).toBe(false);
    o.line_items = [
      { product_id: 'other', quantity: 10 },
      { product_id: 'gift', quantity: 1 },
    ];
    expect(qualifiesForGuide(o, rule)).toBe(false);
  });
  it.each(['pending', 'partially_paid', 'refunded', 'voided'])(
    'does not send for %s payment',
    (status) =>
      expect(
        qualifiesForGuide({ ...order(), financial_status: status }, rule)
      ).toBe(false)
  );
  it('excludes historical, cancelled, test and removed line items', () => {
    expect(
      qualifiesForGuide(
        { ...order(), created_at: '2026-09-30T12:00:00Z' },
        rule
      )
    ).toBe(false);
    expect(
      qualifiesForGuide({ ...order(), cancelled_at: '2026-10-01' }, rule)
    ).toBe(false);
    expect(qualifiesForGuide({ ...order(), test: true }, rule)).toBe(false);
    const o = order();
    o.line_items[1].current_quantity = 0;
    expect(qualifiesForGuide(o, rule)).toBe(false);
  });
  it('uses order email only and rejects address/header injection', () => {
    expect(
      guideRecipient({
        ...order(),
        email: null,
        contact_email: 'b@example.com',
      })
    ).toBe('b@example.com');
    expect(
      guideRecipient({
        ...order(),
        email: 'a@example.com\r\nBcc: c@example.com',
      })
    ).toBeNull();
  });
  it('keeps stable deduplication identities isolated per guide and order', () => {
    expect(guideMessageId('g', '1')).toBe(guideMessageId('g', '1'));
    expect(guideMessageId('g', '1')).not.toBe(guideMessageId('g', '2'));
    expect(guideMessageId('g', '1')).not.toBe(guideMessageId('other', '1'));
  });
  it('only retries explicit rejections; interrupted/ambiguous sends stay uncertain', () => {
    expect(guideSendFailure(429, 0)).toBe('pending');
    expect(guideSendFailure(403, 4)).toBe('failed');
    expect(guideSendFailure(400, 0)).toBe('failed');
    for (const status of [408, 409, 500, 502, 504])
      expect(guideSendFailure(status, 0)).toBe('uncertain');
  });
  it('preserves Spanish content and auto-response headers in MIME', () => {
    const raw = Buffer.from(
      guideEmailRaw({
        from: 'revitaly@example.com',
        to: 'ana@example.com',
        subject: 'Tu guía',
        body: 'Guía gratuita',
        messageId: 'x@riverzai.com',
      }),
      'base64url'
    ).toString();
    expect(raw).toContain('Auto-Submitted: auto-generated');
    expect(raw).toContain(Buffer.from('Guía gratuita').toString('base64'));
    expect(() =>
      guideEmailRaw({
        from: 'x\r\nBcc: y',
        to: 'a@example.com',
        subject: 's',
        body: 'b',
        messageId: 'x',
      })
    ).toThrow('invalid_email_header');
  });
});
