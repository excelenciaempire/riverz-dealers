import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), decrypt: vi.fn() }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({ from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: mocks.read }; return q;
} }) }));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mocks.decrypt, encrypt: vi.fn() }));
vi.mock('@/lib/ai/platform-key', () => ({ invalidatePlatformKeyCache: vi.fn(), platformAnthropicEnvKey: () => process.env.ANTHROPIC_API_KEY || null }));
import { leerClaveAnthropicParaSonda, proveedorActivoEnAdmin } from './claves';
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('ANTHROPIC_API_KEY', 'stale-env-key');
  mocks.read.mockResolvedValue({ data: { anthropic_key_encrypted: 'encrypted' }, error: null });
  mocks.decrypt.mockReturnValue('current-panel-key');
});
afterEach(() => vi.unstubAllEnvs());
it('probes the configured platform key instead of an obsolete Render credential', async () => {
  expect(await leerClaveAnthropicParaSonda()).toBe('current-panel-key');
});
it('uses Render only when no panel key is configured', async () => {
  mocks.read.mockResolvedValue({ data: null, error: null });
  expect(await leerClaveAnthropicParaSonda()).toBe('stale-env-key');
});
it('matches the existing engine fallback when encryption cannot be read', async () => {
  mocks.decrypt.mockImplementation(() => { throw new Error('invalid cipher'); });
  expect(await leerClaveAnthropicParaSonda()).toBe('stale-env-key');
});
it('does not pretend that a database failure means there is no panel key', async () => {
  mocks.read.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
  await expect(leerClaveAnthropicParaSonda()).rejects.toThrow('platform_anthropic_key_read_failed');
});
it('returns no key when neither source is configured', async () => {
  mocks.read.mockResolvedValue({ data: null, error: null }); vi.stubEnv('ANTHROPIC_API_KEY', '');
  expect(await leerClaveAnthropicParaSonda()).toBeNull();
});
it('hides owner-retired providers without disabling the active stack', () => {
  expect(proveedorActivoEnAdmin('apify')).toBe(false);
  for (const id of ['anthropic', 'gemini', 'cerebras', 'groq', 'typesafe', 'telnyx', 'fish']) expect(proveedorActivoEnAdmin(id)).toBe(true);
});
