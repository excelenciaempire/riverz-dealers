import { describe, expect, it } from 'vitest';
import { hasMercadoLibreFailures, onlyPermanentMercadoLibreFailures } from './sync-result';

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

describe('hasMercadoLibreFailures', () => {
  it('ignores connections that only a reconnect can fix', () => {
    expect(hasMercadoLibreFailures({ failures: [
      { connectionId: 'a', error: '[mercadolibre] connection missing refresh_token' },
      { connectionId: 'b', error: '[mercadolibre] token refresh failed (400): invalid_grant' },
    ] })).toBe(false);
  });

  it('still reports real failures next to a reconnect one', () => {
    expect(hasMercadoLibreFailures({ failures: [
      { connectionId: 'a', error: '[mercadolibre] connection missing refresh_token' },
      { connectionId: 'b', error: 'orders/search HTTP 429' },
    ] })).toBe(true);
    expect(hasMercadoLibreFailures({ failures: [
      { connectionId: 'a', error: '[mercadolibre] token refresh failed (503): upstream' },
    ] })).toBe(true);
  });
});
