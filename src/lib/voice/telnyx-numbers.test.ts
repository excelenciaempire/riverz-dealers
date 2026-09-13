import { afterEach, expect, it, vi } from 'vitest';
import { createAddress, TelnyxApiError } from './telnyx-numbers';

afterEach(() => vi.unstubAllGlobals());

it('preserves validation status and machine diagnostics without hiding it as an internal error', async () => {
  vi.stubEnv('TELNYX_API_KEY', 'test');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    errors: [{ code: '10015', title: 'Invalid street', detail: 'Incomplete', source: { pointer: '/street_address' } }],
  }), { status: 422 })));
  try {
    await expect(createAddress({ street_address: 'Incomplete' })).rejects.toMatchObject({
      name: 'TelnyxApiError', status: 422, code: '10015', field: '/street_address', message: 'Telnyx 422: Invalid street: Incomplete',
    });
  } finally { vi.unstubAllEnvs(); }
  expect(TelnyxApiError.prototype).toBeInstanceOf(Error);
});
