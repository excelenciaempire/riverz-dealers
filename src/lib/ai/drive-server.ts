import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { publicBaseUrl } from '@/lib/base-url';
import { DOCUMENT_FAILURES } from './document-contract';
import { DriveProviderError } from './drive-provider';

export const driveHeaders = { 'Cache-Control': 'private, no-store' };
export const driveReply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: driveHeaders });
export const DRIVE_COOKIE = 'riverz_drive_consent';
export async function driveBody(request: Request, maxBytes = 4096) {
  const reader = request.body?.getReader(); if (!reader) return '';
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('document_invalid'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new Error('document_invalid'); }
}
export async function driveRateLimited(reset: number) {
  return NextResponse.json({ error: translate(await getLocale(), 'assistant.driveRateLimit') }, {
    status: 429, headers: { ...driveHeaders, 'Retry-After': String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))) },
  });
}
export function driveCallbackUrl() { return new URL('/api/ai/drive/callback', publicBaseUrl()).toString(); }
export async function driveSession(agentId: string) {
  if (!z.string().uuid().safeParse(agentId).success) return null;
  const auth = await createClient(), { data: { user } } = await auth.auth.getUser();
  if (!user) return null;
  const db = supabaseAdmin();
  const selected = await db.from('ai_agents').select('id,workspace_id').eq('id', agentId).is('deleted_at', null).maybeSingle();
  if (selected.error || !selected.data) return null;
  const allowed = await db.rpc('ai_drive_admin', { p_workspace_id: selected.data.workspace_id, p_actor_id: user.id, p_agent_id: agentId });
  if (allowed.error || allowed.data !== true) return null;
  return { db, workspaceId: selected.data.workspace_id as string, actorId: user.id, agentId };
}
export async function driveFailure(error: unknown) {
  const raw = error instanceof DriveProviderError ? error.code : error && typeof error === 'object' && 'message' in error ? error.message : null;
  const code = typeof raw === 'string' && (DOCUMENT_FAILURES.includes(raw as typeof DOCUMENT_FAILURES[number])
    || ['drive_denied','drive_unavailable','drive_changed','drive_unsupported'].includes(raw)) ? raw : 'drive_unavailable';
  const status = code === 'invalid_document_context' ? 404 : code === 'document_admin_required' || code === 'subscription_read_only' ? 403
    : code === 'drive_unavailable' ? 503 : code === 'document_changed' || code === 'drive_changed' ? 409 : 422;
  return driveReply({ error: translate(await getLocale(), `assistant.${code}`) }, status);
}
