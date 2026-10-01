import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { encrypt, decrypt } from '@/lib/channels/encryption';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { exchangeDriveCode } from '@/lib/ai/drive-provider';
import { DRIVE_COOKIE, driveCallbackUrl, driveFailure, driveReply } from '@/lib/ai/drive-server';
import { publicBaseUrl } from '@/lib/base-url';
import { getLocale } from '@/lib/i18n/server';
import { localizePath } from '@/lib/i18n/routes';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!SHOW_RIVERZ_IMPROVEMENTS) return driveReply({ error: 'not_found' }, 404);
  try {
    const params = new URL(request.url).searchParams, cookieJar = await cookies();
    const state = params.get('state'), code = params.get('code'), cookie = cookieJar.get(DRIVE_COOKIE)?.value;
    if (params.has('error') || !state || !/^[0-9a-f]{64}$/.test(state) || params.getAll('state').length !== 1
      || !code || code.length > 4096 || params.getAll('code').length !== 1 || !cookie || !/^[0-9a-f]{64}$/.test(cookie)) return driveFailure({ message: 'drive_denied' });
    const auth = await createClient(), { data: { user } } = await auth.auth.getUser();
    if (!user) return driveFailure({ message: 'invalid_document_context' });
    const db = supabaseAdmin(), hash = (text: string) => createHash('sha256').update(text).digest('hex');
    const consumed = await db.rpc('consume_ai_drive_oauth', { p_actor_id: user.id, p_state_hash: hash(state), p_cookie_hash: hash(cookie) });
    if (consumed.error) return driveFailure(consumed.error);
    const context = z.object({ workspace_id: z.string().uuid(), agent_id: z.string().uuid(), verifier_ciphertext: z.string().min(10).max(4096) }).strict().parse(consumed.data);
    const verifier = decrypt(context.verifier_ciphertext);
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) return driveFailure({ message: 'drive_denied' });
    const token = await exchangeDriveCode({ code, verifier, redirectUri: driveCallbackUrl() });
    const stored = await db.rpc('connect_ai_drive', { p_actor_id: user.id, p_state_hash: hash(state),
      p_account_id: token.account_id, p_email: token.email, p_credential_ciphertext: encrypt(JSON.stringify(token)) });
    if (stored.error || stored.data !== true) return driveFailure(stored.error);
    cookieJar.delete({ name: DRIVE_COOKIE, path: '/api/ai/drive' });
    const url = new URL(localizePath('/asistente', await getLocale()), publicBaseUrl());
    url.searchParams.set('agent', context.agent_id);
    return NextResponse.redirect(url);
  } catch (error) { return driveFailure(error); }
}
