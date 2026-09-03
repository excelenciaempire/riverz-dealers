import { describe, expect, it, vi } from 'vitest';
import {
  handleMetaGraphError,
  isMetaAuthWarning,
  META_AUTH_ERROR,
} from './meta-auth';

describe('Meta auth failures', () => {
  it('keeps the connection active and records a stable renewal warning', async () => {
    const update = vi.fn(() => ({ eq: vi.fn() }));
    const db = { from: vi.fn(() => ({ update })) };

    await handleMetaGraphError(
      db as never,
      { id: 'connection-1' } as never,
      400,
      { error: { code: 190 } }
    );

    expect(update).toHaveBeenCalledWith({ last_error: META_AUTH_ERROR });
  });

  it('recognizes existing rows written before the stable marker', () => {
    expect(
      isMetaAuthWarning('Token de Meta expirado o sin permisos — reconectar')
    ).toBe(true);
  });
});
