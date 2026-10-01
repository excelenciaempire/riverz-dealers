import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { DOCUMENT_MAX_BYTES, DOCUMENT_MAX_TEXT, type DocumentFailure } from '@/lib/ai/document-contract';
import { DocumentExtractionError, extractDocument } from '@/lib/ai/document-extraction';
import { DocumentSourceError, manageDocumentSource } from '@/lib/ai/document-sources';
import { limitByKey } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Context = { params: Promise<{ id: string }> };
const headers = { 'Cache-Control': 'private, no-cache, no-store, max-age=0, must-revalidate' };
function reply(body: unknown, status = 200) { return NextResponse.json(body, { status, headers }); }
async function failure(code: DocumentFailure) {
  const status = code === 'document_admin_required' || code === 'subscription_read_only' ? 403 : code === 'invalid_document_context' ? 404
    : code === 'document_changed' ? 409 : code === 'document_unavailable' || code === 'document_busy' ? 503 : code === 'document_too_large' ? 413 : 422;
  return reply({ error: translate(await getLocale(), `assistant.${code}`) }, status);
}
async function session(id: string) {
  if (!UUID.test(id)) return null;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const admin = supabaseAdmin();
  const { data: agent, error } = await admin.from('ai_agents').select('id,workspace_id').eq('id', id).is('deleted_at', null).maybeSingle();
  if (error || !agent) return null;
  const member = await admin.from('workspace_members').select('role').eq('workspace_id', agent.workspace_id).eq('user_id', user.id).maybeSingle();
  if (member.error || !member.data) return null;
  return { db: admin, workspaceId: agent.workspace_id as string, actorId: user.id, agentId: id, admin: ['owner','admin'].includes(member.data.role) };
}
function caught(error: unknown) {
  return failure(error instanceof DocumentSourceError || error instanceof DocumentExtractionError ? error.code : 'document_unavailable');
}
export async function GET(request: Request, { params }: Context) {
  if (!SHOW_RIVERZ_IMPROVEMENTS) return reply({ error: 'not_found' }, 404);
  try {
    const target = await session((await params).id);
    if (!target) return failure('invalid_document_context');
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== 'source_id') || query.getAll('source_id').length > 1) return failure('document_invalid');
    const sourceId = query.get('source_id');
    if (sourceId !== null && !UUID.test(sourceId)) return failure('document_invalid');
    const result = await manageDocumentSource(target.db, { ...target, action: sourceId ? 'history' : 'list', sourceId: sourceId ?? undefined });
    return reply(sourceId ? result : { ...result, can_edit: target.admin });
  } catch (error) { return caught(error); }
}
async function boundedBody(request: Request, limit: number): Promise<ArrayBuffer> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new DocumentExtractionError('document_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new DocumentExtractionError('document_invalid');
  const chunks: Uint8Array[] = [];let size = 0;
  try {
    while (true) {
      const part = await reader.read();if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel();throw new DocumentExtractionError('document_too_large'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return new Uint8Array(Buffer.concat(chunks)).buffer;
}
export async function POST(request: Request, { params }: Context) {
  if (!SHOW_RIVERZ_IMPROVEMENTS) return reply({ error: 'not_found' }, 404);
  const block = await csrfGuard(request);if (block) return block;
  try {
    const target = await session((await params).id);
    if (!target) return failure('invalid_document_context');
    if (!target.admin) return failure('document_admin_required');
    const limit = await limitByKey(`documents:import:${target.workspaceId}`, { limit: 20, windowMs: 3600000 });
    if (!limit.success) return NextResponse.json({ error: translate(await getLocale(), 'assistant.documentsRateLimit') }, { status: 429, headers: { ...headers, 'Retry-After': String(Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000))) } });
    const body = await boundedBody(request, DOCUMENT_MAX_BYTES + 16384);
    let form: FormData;
    try { form = await new Request(request.url, { method: 'POST', headers: request.headers, body }).formData(); }
    catch { return failure('document_invalid'); }
    if ([...form.keys()].some(key => !['file','source_id','revision'].includes(key)) || [...new Set(form.keys())].some(key => form.getAll(key).length !== 1)) return failure('document_invalid');
    const file = form.get('file');const sourceId = form.get('source_id'), rawRevision = form.get('revision');
    if (!(file instanceof File) || (sourceId !== null && (typeof sourceId !== 'string' || !UUID.test(sourceId)))
      || (sourceId === null) !== (rawRevision === null) || (rawRevision !== null && (typeof rawRevision !== 'string' || !/^[1-9]\d{0,8}$/.test(rawRevision)))) return failure('document_invalid');
    const document = await extractDocument(file);
    const saved = await manageDocumentSource(target.db, { ...target, action: sourceId ? 'replace' : 'create', ...document,
      sourceId: typeof sourceId === 'string' ? sourceId : undefined, revision: rawRevision ? Number(rawRevision) : undefined });
    return reply(saved, 201);
  } catch (error) { return caught(error); }
}
export async function PATCH(request: Request, { params }: Context) {
  if (!SHOW_RIVERZ_IMPROVEMENTS) return reply({ error: 'not_found' }, 404);
  const block = await csrfGuard(request);if (block) return block;
  try {
    const target = await session((await params).id);
    if (!target) return failure('invalid_document_context');
    const body = JSON.parse(new TextDecoder().decode(await boundedBody(request, 160000))) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['action','source_id','revision','text'].includes(key))
      || typeof body.source_id !== 'string' || !UUID.test(body.source_id) || !Number.isSafeInteger(body.revision) || Number(body.revision) < 1
      || !['edit','activate','withdraw'].includes(String(body.action)) || (body.action === 'edit' ? typeof body.text !== 'string' || !body.text.trim() || body.text.length > DOCUMENT_MAX_TEXT : body.text !== undefined)) return failure('document_invalid');
    return reply(await manageDocumentSource(target.db, { ...target, action: body.action as 'edit'|'activate'|'withdraw', sourceId: body.source_id, revision: Number(body.revision), text: body.text as string | undefined }));
  } catch (error) { return error instanceof SyntaxError ? failure('document_invalid') : caught(error); }
}
