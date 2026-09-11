import { expect, test } from 'vitest';
import { summarizeConfirmedTemplateDelivery } from './template-delivery';

test('counts only template deliveries confirmed by the channel', () => {
  expect(
    summarizeConfirmedTemplateDelivery([
      { status: 'sending' },
      { status: 'failed' },
      { status: 'sent' },
      { status: 'delivered' },
      { status: 'read' },
    ]),
  ).toEqual({ sent: 3, delivered: 2, read: 1 });
});

test('does not turn unconfirmed template attempts into zero deliveries', () => {
  expect(
    summarizeConfirmedTemplateDelivery([
      { status: 'sending' },
      { status: 'failed' },
    ]),
  ).toBeNull();
});
