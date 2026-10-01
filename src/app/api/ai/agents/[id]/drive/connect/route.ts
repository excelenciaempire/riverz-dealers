import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { csrfGuard } from '@/lib/csrf';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { encrypt } from '@/lib/channels/encryption';
import { driveAuthorizationUrl } from '@/lib/ai/drive-provider';
import { DRIVE_COOKIE, driveBody, driveCallbackUrl, driveFailure, driveRateLimited, driveReply, driveSession } from '@/lib/ai/drive-server';
import { limitByKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!SHOW_RIVERZ_IMPROVEMENTS) return driveReply({ error: 'not_found' }, 404);
  const block = await csrfGuard(request); if (block) return block;
  try {
    if ((await driveBody(request)).length) return driveFailure({ message: 'document_invalid' });
    const ctx = await driveSession((await params).id); if (!ctx) return driveFailure({ message: 'invalid_document_context' });
    const limit = await limitByKey(`drive:oauth:${ctx.workspaceId}`, { limit: 10, windowMs: 3_600_000 });
    if (!limit.success) return driveRateLimited(limit.reset);
    const state = randomBytes(32).toString('hex'), cookie = randomBytes(32).toString('hex'), verifier = randomBytes(32).toString('base64url');
    const hash = (text: string) => createHash('sha256').update(text).digest('hex');
    // Resolve configured provider before recording state or changing the cookie.
    const url = driveAuthorizationUrl({ state, challenge: createHash('sha256').update(verifier).digest('base64url'), redirectUri: driveCallbackUrl() });
    const saved = await ctx.db.rpc('start_ai_drive_oauth', { p_workspace_id: ctx.workspaceId, p_actor_id: ctx.actorId, p_agent_id: ctx.agentId,
      p_state_hash: hash(state), p_cookie_hash: hash(cookie), p_verifier_ciphertext: encrypt(verifier) });
    if (saved.error || saved.data !== true) return driveFailure(saved.error);
    (await cookies()).set(DRIVE_COOKIE, cookie, { httpOnly: true, secure: process.env.NODE_ENV === 'production' || new URL(request.url).protocol === 'https:', sameSite: 'lax', maxAge: 600, path: '/api/ai/drive' });
    return driveReply({ url });
  } catch (error) { return driveFailure(error); }
}
