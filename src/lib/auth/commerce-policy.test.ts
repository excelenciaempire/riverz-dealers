import { afterEach, describe, expect, it, vi } from 'vitest';
import { canUseCommerceContext, commerceActor, signCommerceContext, verifyCommerceContext } from './commerce-policy';
import { COMMERCE_TTL_SECONDS } from './commerce-cookies';

const actorId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const workspaceId = '33333333-3333-4333-8333-333333333333';
const admin = { id: actorId, email: 'juandiegoriosmesa@gmail.com' };
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('commerce delegation authority', () => {
  it('binds a signed selection to its authenticated original admin', () => {
    const ctx = verifyCommerceContext(signCommerceContext({ actorId, ownerId, workspaceId }));
    expect(ctx?.workspaceId).toBe(workspaceId);
    expect(canUseCommerceContext(ctx, admin, null)).toBe(true);
    expect(canUseCommerceContext(ctx, { ...admin, id: ownerId }, null)).toBe(false);
    expect(canUseCommerceContext(ctx, { id: actorId, email: 'pilaroficialskin@hotmail.com' }, null)).toBe(false);
    expect(canUseCommerceContext(ctx, null, null)).toBe(false);
  });
  it('allows the existing verified platform-panel actor, not a tenant panel actor', () => {
    const ctx = verifyCommerceContext(signCommerceContext({ actorId, ownerId, workspaceId }));
    expect(canUseCommerceContext(ctx, null, { userId: actorId, email: admin.email })).toBe(true);
    expect(commerceActor(null, { userId: actorId, email: 'pilaroficialskin@hotmail.com' })).toBeNull();
    expect(commerceActor({ ...admin, email: 'Juan.Diego.Rios.Mesa+qa@gmail.com' }, null)?.userId).toBe(actorId);
  });
  it('rejects modified payloads, malformed signatures and signing-key rotation', () => {
    const token = signCommerceContext({ actorId, ownerId, workspaceId });
    const [body, signature] = token.split('.');
    const modified = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), workspaceId: ownerId })).toString('base64url');
    expect(verifyCommerceContext(`${modified}.${signature}`)).toBeNull();
    expect(verifyCommerceContext(`${body}.bad`)).toBeNull();
    expect(verifyCommerceContext(`${token}.extra`)).toBeNull();
    vi.stubEnv('ENCRYPTION_KEY', 'a'.repeat(64));
    expect(verifyCommerceContext(token)).toBeNull();
  });
  it('expires and fails closed without the signing key', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    const token = signCommerceContext({ actorId, ownerId, workspaceId });
    vi.advanceTimersByTime(COMMERCE_TTL_SECONDS * 1000);
    expect(verifyCommerceContext(token)).toBeNull();
    vi.stubEnv('ENCRYPTION_KEY', '');
    expect(() => signCommerceContext({ actorId, ownerId, workspaceId })).toThrow('commerce_signing_key_unavailable');
    expect(verifyCommerceContext(token)).toBeNull();
  });
});
