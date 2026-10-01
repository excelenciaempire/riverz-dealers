import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { userAccess } from '@/lib/mcp/access';
import { limitByKey } from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { HttpActionStoreError, manageHttpAction } from './http-action-store';

async function body(request: Request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new HttpActionStoreError('invalid');
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 16384)) throw new HttpActionStoreError('invalid');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpActionStoreError('invalid');
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > 16384) { await reader.cancel(); throw new HttpActionStoreError('invalid'); }
      chunks.push(chunk.value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { throw new HttpActionStoreError('invalid'); }
  finally { reader.releaseLock(); }
}

/** Configuration only. Nothing here tests or invokes an external endpoint. */
export async function httpActionApi(request: Request, mode: 'list' | 'create' | 'update' | 'history', id?: string) {
  const locale = await getLocale(), headers = { 'Cache-Control': 'private, no-store' };
  const fail = (code: HttpActionStoreError['code'] | 'unauthorized' | 'limited', status: number) => NextResponse.json(
    { error: `http_action_${code}`, message: translate(locale, `settings.httpAction_${code}`) }, { status, headers });
  if (!SHOW_RIVERZ_IMPROVEMENTS) return fail('not_found', 404);
  const write = mode === 'create' || mode === 'update';
  if (write) { const response = await csrfGuard(request); if (response) { response.headers.set('Cache-Control', headers['Cache-Control']); return response; } }
  try {
    const client = await createClient(), auth = await client.auth.getUser();
    if (auth.error || !auth.data.user) return fail('unauthorized', 401);
    const userId = auth.data.user.id, workspaceId = await resolveWorkspaceIdForUser(client, userId);
    if (!workspaceId) return fail('not_found', 404);
    const db = supabaseAdmin(), access = await userAccess(db, userId, workspaceId);
    if (!access?.admin || (access.sections !== null && !access.sections.includes('/ajustes'))) return fail('forbidden', 403);
    const budget = await limitByKey(`http-config:${workspaceId}:${userId}`, { limit: 40, windowMs: 60_000 });
    if (!budget.success) return fail('limited', 429);
    if (id && !z.string().uuid().safeParse(id).success) return fail('not_found', 404);
    if (id) id = id.toLowerCase();
    if ((mode === 'update' || mode === 'history') && !id) return fail('not_found', 404);
    if ([...new URL(request.url).searchParams].length) return fail('invalid', 400);
    if (mode !== 'update') {
      const result = await manageHttpAction(db, workspaceId, userId, mode, id, write ? await body(request) : undefined);
      return NextResponse.json(result, { status: mode === 'create' ? 201 : 200, headers });
    }
    const input = z.record(z.string(), z.unknown()).safeParse(await body(request));
    if (!input.success) return fail('invalid', 400);
    const { operation, ...args } = input.data;
    if (!['save', 'activate', 'withdraw'].includes(String(operation))) return fail('invalid', 400);
    const result = await manageHttpAction(db, workspaceId, userId, operation as 'save' | 'activate' | 'withdraw', id, args);
    return NextResponse.json(result, { headers });
  } catch (error) {
    const code = error instanceof HttpActionStoreError ? error.code : 'unavailable';
    const status = { invalid: 400, not_found: 404, forbidden: 403, changed: 409, credential_required: 400,
      limit: 409, read_only: 402, unavailable: 503 }[code];
    return fail(code, status);
  }
}
