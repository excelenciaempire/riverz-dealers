import { describe, it, expect } from 'vitest';
import { pickModel, MODELS } from './model';

describe('pickModel', () => {
  it('usa el modelo premium para planificar', () => {
    expect(pickModel('plan')).toBe(MODELS.premium);
  });

  it('usa triage para lead scoring y spam', () => {
    expect(pickModel('lead_score')).toBe(MODELS.triage);
    expect(pickModel('spam')).toBe(MODELS.triage);
  });

  it('escala a premium para cerrar solo si el lead es alto', () => {
    expect(pickModel('close', { leadScore: 'high' })).toBe(MODELS.premium);
    expect(pickModel('close', { leadScore: 'low' })).toBe(MODELS.triage);
    expect(pickModel('close')).toBe(MODELS.triage);
  });
});
