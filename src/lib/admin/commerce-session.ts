import 'server-only';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { leerToken, UNLOCK_COOKIE } from '@/lib/admin/unlock';
import { commerceActor, verifyCommerceContext, canUseCommerceContext } from '@/lib/auth/commerce-policy';
import { COMMERCE_CONTEXT_COOKIE } from '@/lib/auth/commerce-cookies';

export async function getCommerceActor() {
  const jar = await cookies();
  const base = await createClient({ actor: true });
  const { data: { user } } = await base.auth.getUser();
  return commerceActor(user, leerToken(jar.get(UNLOCK_COOKIE)?.value));
}

/** No request cookies in cron/provider dispatch: their normal resolution stays unchanged. */
export async function commerceWorkspaceForUser(userId: string): Promise<string | null> {
  let jar;
  try { jar = await cookies(); } catch { return null; }
  const ctx = verifyCommerceContext(jar.get(COMMERCE_CONTEXT_COOKIE)?.value);
  if (!ctx || ctx.ownerId !== userId) return null;
  const base = await createClient({ actor: true });
  const { data: { user } } = await base.auth.getUser();
  return canUseCommerceContext(ctx, user, leerToken(jar.get(UNLOCK_COOKIE)?.value)) ? ctx.workspaceId : null;
}
