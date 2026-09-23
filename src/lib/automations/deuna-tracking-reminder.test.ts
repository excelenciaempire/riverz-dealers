import { describe, expect, it } from 'vitest';
import {
  DEUNA_TRACKING_REMINDER_DELAY_HOURS,
  DEUNA_TRACKING_REMINDER_TEMPLATE,
} from './deuna-tracking-reminder';

describe('DeUNA tracking reminder', () => {
  it('waits 48 hours and asks for the actions that prevent failed COD delivery', () => {
    expect(DEUNA_TRACKING_REMINDER_DELAY_HOURS).toBe(48);
    expect(DEUNA_TRACKING_REMINDER_TEMPLATE.category).toBe('UTILITY');
    expect(DEUNA_TRACKING_REMINDER_TEMPLATE.body).toContain('mantente pendiente del celular');
    expect(DEUNA_TRACKING_REMINDER_TEMPLATE.body).toContain('alguien autorizado');
    expect(DEUNA_TRACKING_REMINDER_TEMPLATE.body).toContain('pagar al recibir');
    expect(DEUNA_TRACKING_REMINDER_TEMPLATE.variableFields).toEqual({
      '1': 'recipient_name',
      '2': 'tracking_number',
    });
  });
});
