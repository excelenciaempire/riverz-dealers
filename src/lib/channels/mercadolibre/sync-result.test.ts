import { describe, expect, it } from 'vitest';
import { onlyPermanentMercadoLibreFailures } from './sync-result';

describe('ML retry classification', () => {
  it('does not rapidly retry blocked accounts', () => {
    expect(onlyPermanentMercadoLibreFailures([
      { failures: [{ connectionId: 'a', error: 'Mercado Libre indica que la cuenta está inactiva.' }] },
      { failures: [{ connectionId: 'a', error: 'messages/unread HTTP 403' }] },
      { failures: [] },
    ])).toBe(true);
  });
  it('retains recovery when another account or subtask has a transient failure', () => {
    expect(onlyPermanentMercadoLibreFailures([
      { failures: [{ connectionId: 'a', error: 'orders/search HTTP 403' }] },
      { error: 'pagination_failed:channel_connections:upstream request timeout' },
    ])).toBe(false);
    expect(onlyPermanentMercadoLibreFailures([{ failures: [] }])).toBe(false);
  });
});
