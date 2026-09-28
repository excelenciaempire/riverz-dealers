import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { activeCreditState, creditFailure, creditKeyDigest, observePlatformCredit } from './provider-credit';
it('ignores a depleted merchant or obsolete credential when checking the current platform key', () => {
  const signals = [{ provider: 'anthropic', key_digest: creditKeyDigest('old-key'), state: 'sin_saldo' }];
  expect(activeCreditState('anthropic', 'current-key', signals)).toBeNull();
  expect(activeCreditState('anthropic', 'old-key', signals)).toBe('sin_saldo');
  expect(activeCreditState('gemini', 'old-key', signals)).toBeNull();
});
it('recognizes billing caps and depleted credit without confusing rate limits or invalid prompts', () => {
  expect(creditFailure(400, { error: { code: 'blocked_api_access' } })).toBe(true);
  expect(creditFailure(429, { error: { code: 'insufficient_quota' } })).toBe(true);
  expect(creditFailure(400, { error: { message: 'Your credit balance is too low to access the API.' } })).toBe(true);
  expect(creditFailure(402, null)).toBe(true);
  for (const status of [400, 401, 403, 429, 500]) expect(creditFailure(status, { error: { message: 'invalid request' } })).toBe(false);
});
it('stores only a digest of the platform credential and does not consume the provider response', async () => {
  const upsert = vi.fn().mockImplementation(() => Object.assign(Promise.resolve({ error: null }), { abortSignal: vi.fn() }));
  const db = { from: () => ({ upsert }) } as unknown as SupabaseClient;
  const res = Response.json({ error: { code: 'blocked_api_access' } }, { status: 400 });
  await observePlatformCredit(db, 'groq', 'test-key-depleted', res);
  expect(upsert.mock.calls[0][0]).toMatchObject({ provider: 'groq', state: 'sin_saldo', key_digest: creditKeyDigest('test-key-depleted') });
  expect(JSON.stringify(upsert.mock.calls)).not.toContain('test-key-depleted');
  expect((await res.json()).error.code).toBe('blocked_api_access');
});
it('recovers on successful paid usage and never treats an HTTP 401 as empty credit', async () => {
  const upsert = vi.fn().mockImplementation(() => Object.assign(Promise.resolve({ error: null }), { abortSignal: vi.fn() }));
  const db = { from: () => ({ upsert }) } as unknown as SupabaseClient;
  await observePlatformCredit(db, 'test-provider', 'recover-key', Response.json({}, { status: 402 }));
  await observePlatformCredit(db, 'test-provider', 'recover-key', Response.json({ usage: {} }));
  await observePlatformCredit(db, 'test-provider', 'recover-key', Response.json({}, { status: 401 }));
  expect(upsert.mock.calls.map((call) => call[0].state)).toEqual(['sin_saldo', 'ok']);
});
it('signal storage failure cannot change the original AI response or billing', async () => {
  const db = { from: () => { throw new Error('DB outage'); } } as unknown as SupabaseClient;
  await expect(observePlatformCredit(db, 'fail-safe', 'safe-key', Response.json({}))).resolves.toBeUndefined();
});
