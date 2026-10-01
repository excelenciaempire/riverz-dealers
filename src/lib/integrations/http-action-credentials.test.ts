import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { httpActionDefinition } from './http-action-contract';
let credentials: typeof import('./http-action-credentials');
const WS = '11111111-1111-4111-8111-111111111111', ID = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const definition = httpActionDefinition.parse({ name: 'Example', description: 'Example integration',
  url: 'https://integration.test/path', method: 'GET', credential_kind: 'bearer', parameters: [], outputs: [] });
beforeAll(async () => { vi.stubEnv('ENCRYPTION_KEY', 'ab'.repeat(32)); vi.resetModules(); credentials = await import('./http-action-credentials'); });
afterAll(() => vi.unstubAllEnvs());
describe('external action credential binding', () => {
  it('uses random authenticated ciphertext, with no plaintext secret in the stored value', () => {
    const one = credentials.sealHttpCredential(WS, ID, definition, 'fixture-secret'), two = credentials.sealHttpCredential(WS, ID, definition, 'fixture-secret');
    expect(one).not.toBe(two); expect(one).not.toContain('fixture-secret'); expect(one.split(':')).toHaveLength(3);
    expect(credentials.openHttpCredential(WS, ID, definition, one)).toEqual({ kind: 'bearer', value: 'fixture-secret' });
  });
  it.each(['workspace', 'action', 'origin', 'kind'])('rejects ciphertext copied to a different %s', part => {
    const ciphertext = credentials.sealHttpCredential(WS, ID, definition, 'fixture-secret');
    const next = { ...definition, ...(part === 'origin' ? { url: 'https://other.test/path' } : {}), ...(part === 'kind' ? { credential_kind: 'api-key' as const } : {}) };
    expect(() => credentials.openHttpCredential(part === 'workspace' ? OTHER : WS, part === 'action' ? OTHER : ID, next, ciphertext)).toThrow('http_action_credential_unavailable');
  });
  it('preserves an origin binding across path changes within the same configured origin', () => {
    const ciphertext = credentials.sealHttpCredential(WS, ID, definition, 'fixture-secret');
    expect(credentials.openHttpCredential(WS, ID, { ...definition, url: 'https://integration.test/new-path' }, ciphertext).value).toBe('fixture-secret');
  });
  it('rejects tampering without exposing secret or ciphertext in the error', () => {
    const ciphertext = credentials.sealHttpCredential(WS, ID, definition, 'fixture-secret');
    const parts = ciphertext.split(':'); parts[1] = (parts[1][0] === 'a' ? 'b' : 'a') + parts[1].slice(1);
    expect(() => credentials.openHttpCredential(WS, ID, definition, parts.join(':'))).toThrow(/^http_action_credential_unavailable$/);
  });
  it.each(['plaintext-secret', 'a'.repeat(32) + ':' + 'b'.repeat(64), 'x'.repeat(20001)])('rejects plaintext, legacy or oversized ciphertext', ciphertext => {
    expect(() => credentials.openHttpCredential(WS, ID, definition, ciphertext)).toThrow('http_action_credential_unavailable');
  });
  it('rejects no-auth definitions and malformed/short secrets before encrypting', () => {
    expect(() => credentials.sealHttpCredential(WS, ID, { ...definition, credential_kind: 'none' }, 'fixture-secret')).toThrow();
    expect(() => credentials.sealHttpCredential(WS, ID, definition, 'short')).toThrow();
    expect(() => credentials.sealHttpCredential(WS, ID, definition, 'secret\r\nHost: private')).toThrow();
  });
});
