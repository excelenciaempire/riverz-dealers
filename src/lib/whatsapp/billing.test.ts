import { describe, expect, it } from 'vitest';
import { whatsappPaymentUrl } from './billing';

describe('whatsappPaymentUrl', () => {
  it('abre el detalle de la cuenta de pago vinculada al WABA', () => {
    expect(
      whatsappPaymentUrl({
        wabaId: '1389249320069111',
        paymentAccountId: '2093344364609773',
        businessId: '122483938904404',
      })
    ).toBe(
      'https://business.facebook.com/latest/billing_hub/accounts/details/?payment_account_id=2093344364609773&asset_id=1389249320069111&business_id=122483938904404'
    );
  });

  it('omite el negocio cuando Meta no lo guardó', () => {
    expect(
      whatsappPaymentUrl({
        wabaId: 'waba con espacios',
        paymentAccountId: 'cuenta/pago',
      })
    ).toBe(
      'https://business.facebook.com/latest/billing_hub/accounts/details/?payment_account_id=cuenta%2Fpago&asset_id=waba+con+espacios'
    );
  });

  it('cae a la configuración general si falta la cuenta de pago', () => {
    expect(whatsappPaymentUrl({ wabaId: '1389249320069111' })).toBe(
      'https://business.facebook.com/latest/billing_hub/payment_settings'
    );
  });
});
