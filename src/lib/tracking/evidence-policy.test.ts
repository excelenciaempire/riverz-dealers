import { describe, expect, it } from 'vitest';
import { validateTrackingVision } from './evidence-policy';

const good = {
  guide: '114015579121', carrier: 'Envía', shipmentStatus: 'En tránsito',
  pageKind: 'tracking_result' as const, otherCustomerDataVisible: false,
  legible: true, safeToSend: true, reason: '',
};

describe('validateTrackingVision', () => {
  it('accepts only a clear result for the exact guide and carrier', () => {
    expect(validateTrackingVision('114015579121', 'Envía', good)).toEqual({ ok: true });
  });
  it.each([
    [{ ...good, guide: '114015579122' }, 'guide_mismatch'],
    [{ ...good, pageKind: 'tracking_form' as const }, 'not_tracking_result'],
    [{ ...good, otherCustomerDataVisible: true }, 'other_customer_data_visible'],
    [{ ...good, shipmentStatus: '' }, 'missing_shipment_status'],
    [{ ...good, shipmentStatus: 'Pendiente de pago' }, 'payment_status_is_not_shipment_status'],
  ])('rejects unsafe or ambiguous evidence', (input, reason) => {
    expect(validateTrackingVision('114015579121', 'Envía', input)).toEqual({ ok: false, reason });
  });
});
