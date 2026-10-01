import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { findCapability } from '@/lib/capabilities/registry';
import { loadCaseReasonReport } from '@/lib/dashboard/case-reason-report';
import { parseCaseReasonQuery } from '@/lib/dashboard/case-reason-contract';
import { isLocale } from '@/lib/i18n/config';
import { localeFromAcceptLanguage } from '@/lib/i18n/detect';
import { translate } from '@/lib/i18n/translate';
import { canAccessConversation } from '@/lib/inbox/access';
import { userAccess, userCanUseTool } from '@/lib/mcp/access';
import { desdeCapacidad } from '@/lib/mcp/tool';
import { rateKey, resolveActor } from '@/lib/mcp/tokens';
import { limitByKey } from '@/lib/rate-limit';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { CHANNELS } from '@/types';

export type ReadResource = 'conversationSearch' | 'conversation' | 'messages' | 'contactSearch' | 'caseReport';
const capabilities: Record<ReadResource, string> = {
  conversationSearch: 'conversaciones.buscar', conversation: 'conversaciones.detalle',
  messages: 'conversaciones.mensajes', contactSearch: 'contactos.buscar', caseReport: 'metricas.resumen',
};
const limit = z.string().regex(/^(?:[1-9]|[1-4][0-9]|50)$/).transform(Number).optional();
const search = z.object({ q: z.string().max(100).optional(), limit }).strict();
const conversationSearch = search.extend({ status: z.enum(['open', 'pending', 'closed']).optional(),
  channel: z.string().refine(value => (CHANNELS as string[]).includes(value)).optional() });
const record = z.record(z.string(), z.unknown());
function entries(params: URLSearchParams) {
  const list = [...params.entries()];
  if (new Set(list.map(([key]) => key)).size !== list.length) throw new Error('invalid_query');
  return Object.fromEntries(list);
}

// The REST contract deliberately excludes internal AI traces, stored error text,
// identity provenance and amounts without a currency. Never spread a database row.
function pick(value: unknown, keys: string[]) {
  const source = record.parse(value);
  return Object.fromEntries(keys.filter(key => key in source).map(key => [key, source[key]]));
}
function project(resource: ReadResource, value: unknown) {
  const source = record.parse(value);
  if (resource === 'conversation') return pick(source, ['conversation_id', 'canal', 'estado', 'contacto',
    'abierta_desde', 'cerrada_el', 'ultimo_mensaje', 'ultimo_lo_escribio', 'ultimo_estado', 'sin_leer', 'ia',
    'asignada_a', 'pidio_humano', 'pidio_humano_el', 'pidio_humano_resumen', 'resumen', 'resumen_al',
    'satisfaccion', 'satisfaccion_comentario', 'satisfaccion_el']);
  if (resource === 'contactSearch') return { contactos: z.array(record).max(50).parse(source.contactos)
    .map(row => pick(row, ['id', 'nombre', 'telefono', 'email', 'canal', 'desde', 'pedidos'])) };
  if (resource === 'messages') return { ...pick(source, ['conversation_id', 'contacto', 'canal']),
    mensajes: z.array(record).max(50).parse(source.mensajes).map(row => pick(row, ['message_id', 'cuando',
      'quien', 'texto', 'asunto', 'transcripcion', 'adjunto', 'tipo', 'estado', 'plantilla', 'lo_mando',
      'oculto', 'me_gusta', 'editado_el', 'reacciones', 'id_externo'])) };
  return { conversaciones: z.array(record).max(50).parse(source.conversaciones).map(row => pick(row,
    ['conversation_id', 'canal', 'estado', 'contacto', 'ultimo_mensaje', 'horas_esperando', 'sin_leer',
      'ia', 'asignada_a', 'pidio_humano'])) };
}

/** Comparison-only, bearer-only read facade. Scope always comes from a current key. */
export async function readApi(request: Request, resource: ReadResource, id?: string) {
  const explicit = request.headers.get('x-riverz-locale');
  const locale = isLocale(explicit) ? explicit : localeFromAcceptLanguage(request.headers.get('accept-language')) ?? 'es';
  const headers: Record<string, string> = { 'Cache-Control': 'private, no-store',
    Vary: 'Authorization, X-Riverz-Locale, Accept-Language', 'Content-Language': locale };
  const fail = (code: 'not_found' | 'unauthorized' | 'forbidden' | 'invalid' | 'limited' | 'unavailable', status: number) =>
    NextResponse.json({ error: code, message: translate(locale, `settings.readApi_${code}`) }, { status, headers });
  // Do not even initialize the service client while the comparison is disabled.
  if (!SHOW_RIVERZ_IMPROVEMENTS) return fail('not_found', 404);
  const bearer = /^Bearer (rvz_[A-Za-z0-9_-]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!bearer || bearer.length > 256) return fail('unauthorized', 401);
  try {
    const db = supabaseAdmin();
    const actor = await resolveActor(db, bearer);
    // OAuth MCP audience and platform/legacy keys are not REST credentials.
    if (!actor || actor.kind !== 'workspace' || !actor.userId || actor.origin !== 'manual') return fail('unauthorized', 401);
    const budget = await limitByKey(rateKey(actor), { limit: 60, windowMs: 60_000 });
    if (!budget.success) {
      headers['Retry-After'] = String(Math.max(1, Math.ceil((budget.reset - Date.now()) / 1000)));
      return fail('limited', 429);
    }
    const auditArgs: Record<string, unknown> = { token_id: actor.tokenId, user_id: actor.userId };
    const audited = async (ok: boolean, status: number) => {
      const result = await db.from('platform_audit_log').insert({ workspace_id: actor.workspaceId,
        actor: `rest:${actor.tokenId}`, tool: `rest.v1.${resource}`, args: auditArgs,
        risk: 'lectura', ok, summary: `HTTP ${status}` });
      if (result.error) throw new Error('read_audit_unavailable');
    };
    const reject = async (code: Parameters<typeof fail>[0], status: number) => { await audited(false, status); return fail(code, status); };
    try {
      const access = await userAccess(db, actor.userId, actor.workspaceId);
      const tool = desdeCapacidad(`rest.v1.${resource}`, capabilities[resource]);
      if (!access || tool.risk !== 'lectura' || tool.platformOnly || !userCanUseTool(access, tool)) return await reject('forbidden', 403);
      let args: Record<string, unknown>, reportQuery;
      try {
        const params = new URL(request.url).searchParams;
        if (resource === 'caseReport') { reportQuery = parseCaseReasonQuery(params); args = {}; }
        else if (resource === 'conversationSearch' || resource === 'contactSearch') {
          const query = (resource === 'conversationSearch' ? conversationSearch : search).parse(entries(params));
          args = { texto: query.q ?? '', limite: query.limit ?? 20 };
          if ('status' in query && query.status) args.estado = query.status;
          if ('channel' in query && query.channel) args.canal = query.channel;
        } else {
          z.string().uuid().parse(id);
          const query = (resource === 'messages' ? z.object({ limit }).strict() : z.object({}).strict()).parse(entries(params));
          args = { conversacion_id: id, ...(resource === 'messages' ? { limite: ('limit' in query ? query.limit : undefined) ?? 30 } : {}) };
          auditArgs.record_id = id;
        }
      } catch { return await reject('invalid', 400); }
      if (args.limite) auditArgs.limit = args.limite;
      // Text queries, bodies, credentials and returned contents never enter the audit.
      if (id) {
        const result = await db.from('conversations').select('id, channel, connection_id')
          .eq('workspace_id', actor.workspaceId).eq('id', id).is('deleted_at', null).maybeSingle();
        if (result.error) throw new Error('conversation_read_unavailable');
        if (!result.data || !(await canAccessConversation(db, actor.userId, result.data, actor.workspaceId))) return await reject('not_found', 404);
      }
      const data = resource === 'caseReport'
        ? await loadCaseReasonReport(db, actor.workspaceId, actor.userId, reportQuery!)
        : project(resource, await findCapability(capabilities[resource])!.run({ db, workspaceId: actor.workspaceId,
          actor: { type: 'mcp', id: actor.label, userId: actor.userId }, locale }, args));
      await audited(true, 200);
      return NextResponse.json({ data }, { headers });
    } catch {
      await audited(false, 503);
      return fail('unavailable', 503);
    }
  } catch { return fail('unavailable', 503); }
}
