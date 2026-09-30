import { createHmac, timingSafeEqual } from 'node:crypto';
import { isPlatformAdmin } from './platform-admin';
import { COMMERCE_TTL_SECONDS } from './commerce-cookies';

export interface CommerceContext {
  actorId: string;
  ownerId: string;
  workspaceId: string;
  expiresAt: number;
}
type Actor = { userId: string; email: string };
type User = { id: string; email?: string | null };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function key() {
  const value = process.env.ENCRYPTION_KEY ?? '';
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('commerce_signing_key_unavailable');
  return Buffer.from(value, 'hex');
}
function signature(body: string) {
  return createHmac('sha256', key()).update(`riverz-commerce:v1:${body}`).digest('base64url');
}
export function signCommerceContext(context: Omit<CommerceContext, 'expiresAt'>, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...context, expiresAt: now + COMMERCE_TTL_SECONDS * 1000 }))
    .toString('base64url');
  return `${body}.${signature(body)}`;
}
export function verifyCommerceContext(token: string | undefined, now = Date.now()): CommerceContext | null {
  if (!token || token.length > 2000) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    const actual = Buffer.from(sig), expected = Buffer.from(signature(body));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const ctx = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CommerceContext;
    if (![ctx.actorId,ctx.ownerId,ctx.workspaceId].every((id) => typeof id === 'string' && UUID.test(id))) return null;
    if (!Number.isFinite(ctx.expiresAt) || ctx.expiresAt <= now || ctx.expiresAt > now + COMMERCE_TTL_SECONDS * 1000) return null;
    return ctx;
  } catch { return null; }
}
/** Authenticated team member or the existing, signed admin-panel session. */
export function commerceActor(user: User | null, panel: Actor | null): Actor | null {
  if (user && isPlatformAdmin(user.email)) return { userId: user.id, email: user.email! };
  if (panel && isPlatformAdmin(panel.email)) return panel;
  return null;
}
export function canUseCommerceContext(ctx: CommerceContext | null, user: User | null, panel: Actor | null) {
  const actor = commerceActor(user, panel);
  return Boolean(ctx && actor && ctx.actorId === actor.userId && ctx.expiresAt > Date.now());
}
