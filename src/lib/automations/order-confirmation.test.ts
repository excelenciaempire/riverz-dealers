import { describe, expect, it } from 'vitest';
import {
  orderConfirmationReason,
  confirmedOrderLogId,
} from './order-confirmation';
describe('order confirmation starts follow-up once', () => {
  it('accepts settled advance payments, not pending or authorized payments', () => {
    expect(orderConfirmationReason({ financial_status: 'paid' })).toBe('paid');
    for (const financial_status of ['pending', 'authorized', 'partially_paid'])
      expect(
        orderConfirmationReason({
          financial_status,
          tags: 'Confirmado',
          payment_gateway_names: ['bank transfer'],
        })
      ).toBeNull();
  });
  it('requires explicit confirmation for cash on delivery', () => {
    const order = {
      financial_status: 'pending',
      payment_gateway_names: ['Pago contra entrega'],
    };
    expect(orderConfirmationReason(order)).toBeNull();
    expect(orderConfirmationReason({ ...order, tags: 'VIP, Confirmado' })).toBe(
      'cod_confirmed'
    );
    expect(
      orderConfirmationReason({ ...order, tags: 'No confirmado' })
    ).toBeNull();
    expect(
      orderConfirmationReason({ ...order, tags: ['Aceptado'] }, 'Aceptado')
    ).toBe('cod_confirmed');
  });
  it('rejects cancelled and refunded orders', () => {
    expect(
      orderConfirmationReason({
        financial_status: 'paid',
        cancelled_at: '2026-09-13',
      })
    ).toBeNull();
    expect(
      orderConfirmationReason({
        financial_status: 'refunded',
        payment_gateway_names: ['cod'],
        tags: 'Confirmado',
      })
    ).toBeNull();
  });
  it('isolates idempotency by account, automation and order', () => {
    const id = confirmedOrderLogId('w', 'a', 'o');
    expect(id).toBe(confirmedOrderLogId('w', 'a', 'o'));
    for (const args of [
      ['w2', 'a', 'o'],
      ['w', 'a2', 'o'],
      ['w', 'a', 'o2'],
    ])
      expect(
        confirmedOrderLogId(...(args as [string, string, string]))
      ).not.toBe(id);
    expect(id).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/
    );
  });
});
