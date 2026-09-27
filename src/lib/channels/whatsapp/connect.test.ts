import { describe, expect, it } from 'vitest';
import { clearRecoveredWhatsAppWarnings } from './connect';

describe('clearRecoveredWhatsAppWarnings', () => {
  it('quita la alarma anterior sin perder la configuración de la cuenta', () => {
    expect(
      clearRecoveredWhatsAppWarnings({
        waba_id: 'waba-1',
        coexistence: true,
        health_sync_error: 'coexistence_echoes_missing',
        echoes_missing_since: '2026-09-20T10:00:00.000Z',
      })
    ).toEqual({ waba_id: 'waba-1', coexistence: true });
  });
});
