import { describe, expect, it } from 'vitest';
import { detectDropiIncidentTransition } from './dropi-incident-signal';

describe('Dropi incident signals from Shopify', () => {
  it('opens only when the official NOVEDAD tag appears', () => {
    expect(
      detectDropiIncidentTransition(
        { tags: 'Confirmado, NOVEDAD: Destinatario ausente' },
        { shop_tags: 'Confirmado' },
      ),
    ).toMatchObject({
      state: 'active',
      transition: 'opened',
      reason: 'Destinatario ausente',
      source: 'shopify_tag',
    });
  });

  it('does not reopen the same incident on another Shopify update', () => {
    expect(
      detectDropiIncidentTransition(
        { tags: 'NOVEDAD: Destinatario ausente' },
        { shop_tags: 'NOVEDAD: Destinatario ausente' },
      ).transition,
    ).toBeNull();
  });

  it('lets NOVEDAD SOLUCIONADA win when Dropify keeps both tags', () => {
    expect(
      detectDropiIncidentTransition(
        { tags: 'NOVEDAD, NOVEDAD SOLUCIONADA' },
        { shop_tags: 'NOVEDAD' },
      ),
    ).toMatchObject({ state: 'resolved', transition: 'resolved' });
  });

  it('recognizes Shopify carrier exceptions without using order notes', () => {
    expect(
      detectDropiIncidentTransition(
        { shipment_status: 'attempted_delivery', note: 'ignore this text' },
        { shipment_status: 'in_transit' },
      ),
    ).toMatchObject({
      state: 'active',
      transition: 'opened',
      source: 'shopify_shipment',
    });
  });

  it('resolves a carrier exception after movement resumes', () => {
    expect(
      detectDropiIncidentTransition(
        { shipment_status: 'in_transit' },
        { shipment_status: 'failure' },
      ).transition,
    ).toBe('resolved');
  });
});
