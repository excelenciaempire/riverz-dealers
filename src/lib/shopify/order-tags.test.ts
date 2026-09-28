import { describe, expect, it } from 'vitest';
import { nextDeliveryIncidentTags } from './order-tags';

describe('Dropi incident order tags', () => {
  it('preserves unrelated tags and replaces previous incident state', () => {
    expect(
      nextDeliveryIncidentTags(
        ['Confirmado', 'NOVEDAD SOLUCIONADA', 'VIP'],
        'active',
        'DESTINATARIO SE REHUSA A RECIBIR',
      ),
    ).toEqual([
      'Confirmado',
      'VIP',
      'NOVEDAD: DESTINATARIO SE REHUSA A RECIBIR',
    ]);
  });

  it('resolves an active incident without duplicating the tag', () => {
    expect(
      nextDeliveryIncidentTags(
        ['NOVEDAD: Dirección incompleta', 'NOVEDAD SOLUCIONADA', 'Confirmado'],
        'resolved',
      ),
    ).toEqual(['Confirmado', 'NOVEDAD SOLUCIONADA']);
  });

  it('removes commas and line breaks from the Shopify tag', () => {
    expect(nextDeliveryIncidentTags([], 'active', 'Dirección, incompleta\nApto 2')).toEqual([
      'NOVEDAD: Dirección; incompleta; Apto 2',
    ]);
  });
});
