export type TrackingVisionResult = {
  guide: string;
  carrier: string;
  shipmentStatus: string;
  pageKind: 'tracking_result' | 'tracking_form' | 'error' | 'unknown';
  otherCustomerDataVisible: boolean;
  legible: boolean;
  safeToSend: boolean;
  reason: string;
};

export function normalizeGuide(value: unknown): string {
  return String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function validateTrackingVision(
  expectedGuide: string,
  expectedCarrier: string,
  result: TrackingVisionResult,
): { ok: true } | { ok: false; reason: string } {
  if (result.pageKind !== 'tracking_result') return { ok: false, reason: 'not_tracking_result' };
  if (!result.legible) return { ok: false, reason: 'screenshot_not_legible' };
  if (!result.safeToSend) return { ok: false, reason: result.reason || 'vision_rejected' };
  if (result.otherCustomerDataVisible) return { ok: false, reason: 'other_customer_data_visible' };
  if (normalizeGuide(result.guide) !== normalizeGuide(expectedGuide)) {
    return { ok: false, reason: 'guide_mismatch' };
  }
  const carrier = result.carrier.toLocaleLowerCase('es');
  const expected = expectedCarrier.toLocaleLowerCase('es');
  if (!carrier || (!carrier.includes(expected) && !expected.includes(carrier))) {
    return { ok: false, reason: 'carrier_mismatch' };
  }
  if (!result.shipmentStatus.trim()) return { ok: false, reason: 'missing_shipment_status' };
  if (/\b(pago|payment|cobro)\b/i.test(result.shipmentStatus)) {
    return { ok: false, reason: 'payment_status_is_not_shipment_status' };
  }
  return { ok: true };
}
