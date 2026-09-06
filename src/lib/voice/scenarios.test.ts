import { describe, expect, it } from 'vitest';
import {
  inferVoiceCallScenario,
  isCashOnDelivery,
  objectiveForVoiceScenario,
  voiceCallTypeForScenario,
} from './scenarios';

describe('voice call scenarios', () => {
  it('distinguishes a COD order from a prepaid order', () => {
    expect(inferVoiceCallScenario('shopify_order_created', {
      payment_method: 'Cash on Delivery (COD)',
    })).toBe('confirm_cod');
    expect(inferVoiceCallScenario('shopify_order_created', {
      payment_method: 'Shopify Payments',
    })).toBe('thank_order');
  });

  it('recognizes common COD values without treating pending as COD', () => {
    expect(isCashOnDelivery({ gateway: 'contra_entrega' })).toBe(true);
    expect(isCashOnDelivery({ payment_methods: ['Pago al recibir'] })).toBe(true);
    expect(isCashOnDelivery({ financial_status: 'pending' })).toBe(false);
  });

  it('maps commerce triggers to a clear business reason', () => {
    expect(inferVoiceCallScenario('shopify_abandoned_checkout')).toBe('cart_recovery');
    expect(inferVoiceCallScenario('payment_rejected')).toBe('payment_recovery');
    expect(inferVoiceCallScenario('shopify_order_fulfilled')).toBe('delivery_update');
    expect(inferVoiceCallScenario('customer_inactive')).toBe('customer_followup');
    expect(inferVoiceCallScenario('new_message_received')).toBeNull();
  });

  it('keeps scenario objectives bilingual and on existing call types', () => {
    expect(voiceCallTypeForScenario('confirm_cod')).toBe('order_confirmation');
    expect(objectiveForVoiceScenario('thank_order', 'es')).toContain('Agradece');
    expect(objectiveForVoiceScenario('thank_order', 'en')).toContain('Thank');
    expect(objectiveForVoiceScenario('custom', 'es')).toBeNull();
  });
});
