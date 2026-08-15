import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { assertMetadataOnly } from './pii';
import { workspaceNames } from './queries';
import {
  LOG_KINDS,
  isLogKind,
  type LogKind,
  type LogEntry,
} from './log-kinds';

/**
 * Visor unificado de logs de plataforma.
 *
 * Riverz ya escribe un rastro muy detallado de todo lo que hace — y hasta
 * ahora casi nadie lo leía. `ai_replies.skip_reason` en particular explica por
 * qué la IA decidió no contestar, y no se mostraba en ninguna pantalla.
 *
 * Cada fuente devuelve la MISMA forma (`LogEntry`) para que la UI sea una sola
 * tabla con pestañas. Nunca se devuelve el cuerpo de un mensaje: estado,
 * código, motivo y referencias, nada más.
 */

export { LOG_KINDS, isLogKind };
export type { LogKind, LogEntry };

export interface LogFilters {
  kind: LogKind;
  workspaceId?: string;
  status?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

function db(): SupabaseClient {
  return supabaseAdmin();
}

/** Aplica los filtros comunes a cualquier consulta de log. */
function applyCommon(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  f: LogFilters,
  opts: { workspaceColumn?: string | null; timeColumn?: string } = {},
) {
  const timeColumn = opts.timeColumn ?? 'created_at';
  const wsColumn = opts.workspaceColumn === undefined ? 'workspace_id' : opts.workspaceColumn;
  let q = query;
  if (f.from) q = q.gte(timeColumn, f.from.toISOString());
  if (f.to) q = q.lt(timeColumn, f.to.toISOString());
  if (f.workspaceId && wsColumn) q = q.eq(wsColumn, f.workspaceId);
  const offset = f.offset ?? 0;
  return q
    .order(timeColumn, { ascending: false })
    .range(offset, offset + (f.limit ?? 100) - 1);
}

function select(table: string, columns: string) {
  assertMetadataOnly(table, columns);
  return db().from(table).select(columns);
}

// ────────────────────────────────────────────────────────────────

async function aiLogs(f: LogFilters): Promise<LogEntry[]> {
  let q = select(
    'ai_replies',
    'id, workspace_id, agent_id, conversation_id, status, skip_reason, error, prompt_tokens, completion_tokens, created_at',
  );
  if (f.status) q = q.eq('status', f.status);
  const { data, error } = await applyCommon(q, f);
  if (error) throw new Error(`[admin/logs] ai: ${error.message}`);

  return ((data ?? []) as Array<{
    id: string;
    workspace_id: string;
    agent_id: string | null;
    conversation_id: string | null;
    status: string;
    skip_reason: string | null;
    error: string | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    at: r.created_at,
    workspaceId: r.workspace_id,
    workspaceName: null,
    level: r.status === 'failed' ? 'error' : r.status === 'skipped' ? 'warn' : 'ok',
    status: r.status,
    detail: r.error ?? r.skip_reason ?? null,
    extra: {
      agent_id: r.agent_id,
      conversation_id: r.conversation_id,
      prompt_tokens: r.prompt_tokens,
      completion_tokens: r.completion_tokens,
    },
  }));
}

async function automationLogs(f: LogFilters): Promise<LogEntry[]> {
  // steps_executed queda fuera a propósito: puede contener el texto de los
  // mensajes que la automatización envió.
  let q = select(
    'automation_logs',
    'id, workspace_id, automation_id, trigger_event, status, error_message, created_at',
  );
  if (f.status) q = q.eq('status', f.status);
  const { data, error } = await applyCommon(q, f);
  if (error) throw new Error(`[admin/logs] automations: ${error.message}`);

  return ((data ?? []) as Array<{
    id: string;
    workspace_id: string | null;
    automation_id: string;
    trigger_event: string;
    status: string;
    error_message: string | null;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    at: r.created_at,
    workspaceId: r.workspace_id,
    workspaceName: null,
    level: r.status === 'failed' ? 'error' : r.status === 'partial' ? 'warn' : 'ok',
    status: r.status,
    detail: r.error_message ?? r.trigger_event,
    extra: { automation_id: r.automation_id, trigger: r.trigger_event },
  }));
}

async function flowLogs(f: LogFilters): Promise<LogEntry[]> {
  let q = select(
    'flow_runs',
    'id, workspace_id, flow_id, status, end_reason, current_node_key, started_at, ended_at',
  );
  if (f.status) q = q.eq('status', f.status);
  const { data, error } = await applyCommon(q, f, { timeColumn: 'started_at' });
  if (error) throw new Error(`[admin/logs] flows: ${error.message}`);

  return ((data ?? []) as Array<{
    id: string;
    workspace_id: string | null;
    flow_id: string;
    status: string;
    end_reason: string | null;
    current_node_key: string | null;
    started_at: string;
    ended_at: string | null;
  }>).map((r) => ({
    id: r.id,
    at: r.started_at,
    workspaceId: r.workspace_id,
    workspaceName: null,
    level:
      r.status === 'failed'
        ? 'error'
        : r.status === 'timed_out' || r.status === 'paused_by_agent'
          ? 'warn'
          : 'ok',
    status: r.status,
    detail: r.end_reason ?? r.current_node_key,
    extra: { flow_id: r.flow_id, node: r.current_node_key, ended_at: r.ended_at },
  }));
}

async function messageLogs(f: LogFilters): Promise<LogEntry[]> {
  // messages no tiene workspace_id: cuelga de conversations. El embed !inner
  // permite además filtrar por comercio.
  const columns =
    'id, status, error_code, error_reason, held_for_quality, delivery_unconfirmed_at, created_at, conversations!inner(workspace_id)';
  assertMetadataOnly('messages', columns);
  let q = db().from('messages').select(columns);
  q = q.eq('status', f.status ?? 'failed');
  const { data, error } = await applyCommon(q, f, {
    workspaceColumn: 'conversations.workspace_id',
  });
  if (error) throw new Error(`[admin/logs] messages: ${error.message}`);

  return ((data ?? []) as unknown as Array<{
    id: string;
    status: string;
    error_code: number | null;
    error_reason: string | null;
    held_for_quality: boolean;
    delivery_unconfirmed_at: string | null;
    created_at: string;
    conversations: { workspace_id: string | null } | { workspace_id: string | null }[];
  }>).map((r) => {
    const conv = Array.isArray(r.conversations) ? r.conversations[0] : r.conversations;
    return {
      id: r.id,
      at: r.created_at,
      workspaceId: conv?.workspace_id ?? null,
      workspaceName: null,
      level: r.status === 'failed' ? ('error' as const) : ('warn' as const),
      status: r.status,
      detail: r.error_reason ?? (r.error_code ? `Meta ${r.error_code}` : null),
      extra: {
        error_code: r.error_code,
        held_for_quality: r.held_for_quality ? 'sí' : 'no',
        unconfirmed_at: r.delivery_unconfirmed_at,
      },
    };
  });
}

async function webhookLogs(f: LogFilters): Promise<LogEntry[]> {
  // raw_body / headers quedan fuera: son la carga cruda de Meta, con mensajes
  // y teléfonos dentro.
  const q = select(
    'webhook_events_raw',
    'id, provider, received_at, processed_at, attempts, last_error',
  ).is('processed_at', null);
  const { data, error } = await applyCommon(q, f, {
    workspaceColumn: null,
    timeColumn: 'received_at',
  });
  if (error) throw new Error(`[admin/logs] webhooks: ${error.message}`);

  return ((data ?? []) as Array<{
    id: string;
    provider: string;
    received_at: string;
    attempts: number;
    last_error: string | null;
  }>).map((r) => ({
    id: r.id,
    at: r.received_at,
    workspaceId: null,
    workspaceName: null,
    level: r.last_error ? 'error' : 'warn',
    status: r.last_error ? 'error' : 'pendiente',
    detail: r.last_error ?? r.provider,
    extra: { provider: r.provider, attempts: r.attempts },
  }));
}

async function commentToDmLogs(f: LogFilters): Promise<LogEntry[]> {
  const q = select(
    'comment_to_dm_log',
    'id, workspace_id, rule_id, channel, public_reply_status, dm_status, error, created_at',
  );
  const { data, error } = await applyCommon(q, f);
  if (error) throw new Error(`[admin/logs] comment_to_dm: ${error.message}`);

  return ((data ?? []) as Array<{
    id: string;
    workspace_id: string;
    rule_id: string;
    channel: string;
    public_reply_status: string | null;
    dm_status: string | null;
    error: string | null;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    at: r.created_at,
    workspaceId: r.workspace_id,
    workspaceName: null,
    level: r.error || r.dm_status === 'failed' ? 'error' : 'ok',
    status: r.dm_status ?? r.public_reply_status,
    detail: r.error ?? `${r.channel} · DM ${r.dm_status ?? '—'}`,
    extra: {
      channel: r.channel,
      public_reply: r.public_reply_status,
      dm: r.dm_status,
      rule_id: r.rule_id,
    },
  }));
}

async function igProactiveLogs(f: LogFilters): Promise<LogEntry[]> {
  // `text` es el DM que se le mandó a una persona: fuera.
  const q = select(
    'ig_proactive_log',
    'id, workspace_id, campaign_id, kind, created_at',
  );
  const { data, error } = await applyCommon(q, f);
  if (error) throw new Error(`[admin/logs] ig_proactive: ${error.message}`);

  return ((data ?? []) as Array<{
    id: string;
    workspace_id: string;
    campaign_id: string | null;
    kind: string;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    at: r.created_at,
    workspaceId: r.workspace_id,
    workspaceName: null,
    level: 'ok',
    status: r.kind,
    detail: r.kind,
    extra: { campaign_id: r.campaign_id },
  }));
}

async function voiceLogs(f: LogFilters): Promise<LogEntry[]> {
  let q = select(
    'voice_calls',
    'id, workspace_id, direction, call_type, status, outcome, duration_seconds, error, cost, created_at',
  );
  if (f.status) q = q.eq('status', f.status);
  const { data, error } = await applyCommon(q, f);
  if (error) throw new Error(`[admin/logs] voice: ${error.message}`);

  return ((data ?? []) as Array<{
    id: string;
    workspace_id: string;
    direction: string;
    call_type: string;
    status: string;
    outcome: string | null;
    duration_seconds: number | null;
    error: string | null;
    cost: { total_usd?: number } | null;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    at: r.created_at,
    workspaceId: r.workspace_id,
    workspaceName: null,
    level:
      r.status === 'failed' || r.error
        ? 'error'
        : r.status === 'no_answer' || r.status === 'busy'
          ? 'warn'
          : 'ok',
    status: r.status,
    detail: r.error ?? r.outcome ?? r.call_type,
    extra: {
      direction: r.direction,
      call_type: r.call_type,
      outcome: r.outcome,
      seconds: r.duration_seconds,
      cost_usd: r.cost?.total_usd ?? null,
    },
  }));
}

/**
 * Plantillas de WhatsApp. El negocio depende de que Meta las apruebe: una
 * rechazada no se puede usar en ninguna campaña ni automatización, y una que
 * queda en PENDING para siempre suele ser el WABA bloqueado por facturación.
 * No había ninguna pantalla del panel que las mirara.
 */
async function templateLogs(f: LogFilters): Promise<LogEntry[]> {
  let q = select(
    'message_templates',
    'id, workspace_id, name, status, category, language, rejected_reason, updated_at, created_at',
  );
  if (f.status) q = q.ilike('status', f.status);
  const { data, error } = await applyCommon(q, f, { timeColumn: 'updated_at' });
  if (error) throw new Error(`[admin/logs] templates: ${error.message}`);

  return ((data ?? []) as unknown as Array<{
    id: string;
    workspace_id: string;
    name: string;
    status: string | null;
    category: string | null;
    language: string | null;
    rejected_reason: string | null;
    updated_at: string;
  }>).map((r) => {
    const status = (r.status ?? '').toLowerCase();
    return {
      id: r.id,
      at: r.updated_at,
      workspaceId: r.workspace_id,
      workspaceName: null,
      level:
        status === 'rejected' ? 'error' : status === 'approved' ? 'ok' : 'warn',
      status: r.status,
      detail: r.rejected_reason ?? r.name,
      extra: { name: r.name, category: r.category, language: r.language },
    } satisfies LogEntry;
  });
}

/**
 * Campañas. Antes sólo existían como un número suelto en la ficha del comercio,
 * así que una que quedaba "enviando" y no terminaba no se veía por ningún lado.
 */
async function broadcastLogs(f: LogFilters): Promise<LogEntry[]> {
  let q = select(
    'broadcasts',
    'id, workspace_id, name, status, total_recipients, sent_count, failed_count, error_message, updated_at, created_at',
  );
  if (f.status) q = q.eq('status', f.status);
  const { data, error } = await applyCommon(q, f, { timeColumn: 'updated_at' });
  if (error) throw new Error(`[admin/logs] broadcasts: ${error.message}`);

  return ((data ?? []) as unknown as Array<{
    id: string;
    workspace_id: string;
    name: string | null;
    status: string;
    total_recipients: number | null;
    sent_count: number | null;
    failed_count: number | null;
    error_message: string | null;
    updated_at: string;
  }>).map((r) => ({
    id: r.id,
    at: r.updated_at,
    workspaceId: r.workspace_id,
    workspaceName: null,
    level:
      r.status === 'failed' || r.error_message
        ? 'error'
        : (r.failed_count ?? 0) > 0 || r.status === 'sending'
          ? 'warn'
          : 'ok',
    status: r.status,
    detail: r.error_message ?? r.name,
    extra: {
      recipients: r.total_recipients,
      sent: r.sent_count,
      failed: r.failed_count,
    },
  }));
}

/**
 * Corridas de los trabajos de fondo. `/admin/operacion` muestra la ÚLTIMA de
 * cada uno; acá está el historial, que es donde se ve si algo falla siempre o
 * falló una vez.
 */
async function cronLogs(f: LogFilters): Promise<LogEntry[]> {
  let q = select(
    'cron_runs',
    'id, name, status, started_at, finished_at, duration_ms, error',
  );
  if (f.status) q = q.eq('status', f.status);
  const { data, error } = await applyCommon(q, f, {
    workspaceColumn: null,
    timeColumn: 'started_at',
  });
  if (error) throw new Error(`[admin/logs] crons: ${error.message}`);

  return ((data ?? []) as unknown as Array<{
    id: string | number;
    name: string;
    status: string;
    started_at: string;
    duration_ms: number | null;
    error: string | null;
  }>).map((r) => ({
    id: String(r.id),
    at: r.started_at,
    // Los trabajos son de la plataforma, no de un comercio.
    workspaceId: null,
    workspaceName: null,
    level: r.status === 'ok' ? 'ok' : 'error',
    status: r.status,
    detail: r.error ?? r.name,
    extra: { job: r.name, ms: r.duration_ms },
  }));
}

/**
 * Decisiones que esperaron a una persona. Es el registro de quién aprobó qué
 * y por dónde — y de las que vencieron sin que nadie contestara, que es el
 * modo de falla silencioso de todo este camino.
 */
async function approvalLogs(f: LogFilters): Promise<LogEntry[]> {
  let q = select(
    'approval_requests',
    'id, workspace_id, kind, title, status, decided_via, decided_at, result, created_at',
  );
  if (f.status) q = q.eq('status', f.status);
  const { data, error } = await applyCommon(q, f);
  if (error) throw new Error(`[admin/logs] approvals: ${error.message}`);

  return ((data ?? []) as unknown as Array<{
    id: string;
    workspace_id: string;
    kind: string;
    title: string | null;
    status: string;
    decided_via: string | null;
    decided_at: string | null;
    result: string | null;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    at: r.created_at,
    workspaceId: r.workspace_id,
    workspaceName: null,
    level:
      r.status === 'fallida' || r.status === 'vencida'
        ? 'error'
        : r.status === 'pendiente'
          ? 'warn'
          : 'ok',
    status: r.status,
    detail: r.result ?? r.title,
    extra: { kind: r.kind, via: r.decided_via, decided_at: r.decided_at },
  }));
}

const READERS: Record<LogKind, (f: LogFilters) => Promise<LogEntry[]>> = {
  ai: aiLogs,
  automations: automationLogs,
  flows: flowLogs,
  messages: messageLogs,
  templates: templateLogs,
  broadcasts: broadcastLogs,
  webhooks: webhookLogs,
  crons: cronLogs,
  approvals: approvalLogs,
  comment_to_dm: commentToDmLogs,
  ig_proactive: igProactiveLogs,
  voice: voiceLogs,
};

/** Lee una fuente de log y le pone nombre a cada comercio. */
export async function readLogs(f: LogFilters): Promise<LogEntry[]> {
  const entries = await READERS[f.kind](f);
  const names = await workspaceNames(
    entries.map((e) => e.workspaceId).filter((v): v is string => Boolean(v)),
  );
  return entries.map((e) => ({
    ...e,
    workspaceName: e.workspaceId ? (names.get(e.workspaceId) ?? null) : null,
  }));
}
