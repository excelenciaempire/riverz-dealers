import { describe, it, expect } from 'vitest';
import { coercePlan } from './types';

describe('coercePlan', () => {
  const valid = {
    campaign_name: 'Oferta junio',
    audience: { description: 'Comentaron el reel', source: 'reel junio', estimated_reach: 120 },
    message: { text: 'hola {{nombre}} 👋', preview_name: 'María' },
    offer: { code: 'junio10', discount: '10%', conditions: 'hasta agotar' },
    follow_up: '¿seguís ahí?',
    comment_reply: 'te escribí por DM 💙',
    recommended_products: ['Pulsera oro', 'Anillo plata'],
    funnel: { contacted: 120, replies: 40, conversions: 12, est_revenue: '$1,200 USD' },
    next_steps: ['Conectar Instagram', 'Lanzar'],
  };

  it('acepta un plan válido y normaliza el código de oferta a mayúsculas', () => {
    const plan = coercePlan(valid);
    expect(plan).not.toBeNull();
    expect(plan!.campaign_name).toBe('Oferta junio');
    expect(plan!.offer?.code).toBe('JUNIO10');
    expect(plan!.audience.estimated_reach).toBe(120);
  });

  it('devuelve null si falta lo esencial (campaign_name / audience / message)', () => {
    expect(coercePlan(null)).toBeNull();
    expect(coercePlan({})).toBeNull();
    expect(coercePlan({ campaign_name: 'x' })).toBeNull();
    expect(
      coercePlan({ campaign_name: 'x', audience: {}, message: {} }),
    ).toBeNull();
  });

  it('rellena defaults seguros para campos opcionales ausentes', () => {
    const plan = coercePlan({
      campaign_name: 'min',
      audience: { description: 'algo' },
      message: { text: 'hola' },
    });
    expect(plan).not.toBeNull();
    expect(plan!.offer).toBeNull();
    expect(plan!.recommended_products).toEqual([]);
    expect(plan!.next_steps).toEqual([]);
    expect(plan!.message.preview_name).toBe('María');
    expect(plan!.audience.estimated_reach).toBe(0);
  });

  it('descarta una oferta sin código', () => {
    const plan = coercePlan({ ...valid, offer: { discount: '10%' } });
    expect(plan!.offer).toBeNull();
  });
});
