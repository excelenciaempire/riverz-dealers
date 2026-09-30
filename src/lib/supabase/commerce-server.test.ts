import { beforeEach, expect, it, vi } from 'vitest';
import { signCommerceContext } from '@/lib/auth/commerce-policy';
import { COMMERCE_AUTH_COOKIE, COMMERCE_CONTEXT_COOKIE } from '@/lib/auth/commerce-cookies';

const m = vi.hoisted(() => ({ jar: new Map<string, string>(), baseUser: vi.fn(), ownerUser: vi.fn(), make: vi.fn(), panel: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ has: (name: string) => m.jar.has(name), get: (name: string) => ({ value: m.jar.get(name) }), getAll: () => [...m.jar].map(([name, value]) => ({ name, value })), set: vi.fn() }) }));
vi.mock('@supabase/ssr', () => ({ createServerClient: m.make }));
vi.mock('@/lib/admin/unlock', () => ({ UNLOCK_COOKIE: 'riverz_admin_unlock', leerToken: m.panel }));
import { createClient } from './server';

const actorId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const workspaceId = '33333333-3333-4333-8333-333333333333';
beforeEach(() => {
  vi.resetAllMocks(); m.jar.clear();
  m.baseUser.mockResolvedValue({ data: { user: { id: actorId, email: 'juandiegoriosmesa@gmail.com' } } });
  m.ownerUser.mockResolvedValue({ data: { user: { id: ownerId, email: 'nativa@riverz.co' } } });
  m.panel.mockReturnValue(null);
  m.make.mockImplementation((_url: string, _key: string, options: { cookieOptions: { name?: string } }) => ({
    kind: options.cookieOptions.name === COMMERCE_AUTH_COOKIE ? 'commerce' : 'original',
    auth: { getUser: options.cookieOptions.name === COMMERCE_AUTH_COOKIE ? m.ownerUser : m.baseUser },
  }));
});
it('keeps ordinary requests in the original cookie namespace with no extra auth reads', async () => {
  expect(await createClient()).toMatchObject({ kind: 'original' });
  expect(m.make).toHaveBeenCalledTimes(1);
  expect(m.baseUser).not.toHaveBeenCalled();
});
it('uses the delegated session only after verifying the original admin and selected owner', async () => {
  m.jar.set(COMMERCE_CONTEXT_COOKIE, signCommerceContext({ actorId, ownerId, workspaceId }));
  expect(await createClient()).toMatchObject({ kind: 'commerce' });
  expect(m.baseUser).toHaveBeenCalledOnce();
  expect(m.ownerUser).toHaveBeenCalledOnce();
});
it('always resolves the real administrator login when explicitly requested', async () => {
  m.jar.set(COMMERCE_CONTEXT_COOKIE, signCommerceContext({ actorId, ownerId, workspaceId }));
  expect(await createClient({ actor: true })).toMatchObject({ kind: 'original' });
  expect(m.ownerUser).not.toHaveBeenCalled();
});
it('does not elevate a merchant with a copied signed context or absent admin login', async () => {
  m.jar.set(COMMERCE_CONTEXT_COOKIE, signCommerceContext({ actorId, ownerId, workspaceId }));
  m.baseUser.mockResolvedValueOnce({ data: { user: { id: actorId, email: 'pilaroficialskin@hotmail.com' } } });
  expect(await createClient()).toMatchObject({ kind: 'original' });
  m.baseUser.mockResolvedValueOnce({ data: { user: null } });
  expect(await createClient()).toMatchObject({ kind: 'original' });
  expect(m.ownerUser).not.toHaveBeenCalled();
});
it('fails closed if the delegated JWT owner differs from the signed store context', async () => {
  m.jar.set(COMMERCE_CONTEXT_COOKIE, signCommerceContext({ actorId, ownerId, workspaceId }));
  m.ownerUser.mockResolvedValue({ data: { user: { id: actorId } } });
  await expect(createClient()).rejects.toThrow('commerce_session_invalid');
});
it('rejects unsigned selection without consulting a delegated cookie', async () => {
  m.jar.set(COMMERCE_CONTEXT_COOKIE, 'forged.context');
  expect(await createClient()).toMatchObject({ kind: 'original' });
  expect(m.ownerUser).not.toHaveBeenCalled();
});
