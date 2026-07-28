import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { assertMetadataOnly } from './pii';

/**
 * Capa de lectura del panel de plataforma — la única del código que cruza
 * workspaces.
 *
 * Dos reglas que no se negocian:
 *  1. **Solo lectura.** Ninguna función de este módulo escribe en tablas de un
 *     comercio. Las únicas escrituras del panel son su propia auditoría
 *     (`admin_audit_log`) y la configuración de plataforma.
 *  2. **Solo metadatos.** Cada `select` pasa por `assertMetadataOnly()`, que
 *     revienta si alguien pide el cuerpo de un mensaje o PII del comprador.
 *
 * Los agregados pesados están en SQL (migración 125): paginar PostgREST en JS
 * no escala a nivel plataforma.
 */

function db(): SupabaseClient {
  return supabaseAdmin();
}

/** `select()` con la barrera de privacidad puesta delante. */
function safeSelect(client: SupabaseClient, table: string, columns: string) {
  assertMetadataOnly(table, columns);
  return client.from(table).select(columns);
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(`[admin] rpc ${fn}: ${error.message}`);
  return (data ?? []) as T[];
}

// ────────────────────────────────────────────────────────────────
// Resumen de plataforma
// ────────────────────────────────────────────────────────────────

export interface PlatformOverview {
  workspaces_total: number;
  workspaces_active: number;
  workspaces_deleted: number;
  workspaces_new: number;
  users_total: number;
  contacts_total: number;
  conversations_total: number;
  conversations_new: number;
  messages_in: number;
  messages_out: number;
  messages_failed: number;
  ai_sent: number;
  ai_skipped: number;
  ai_failed: number;
  ai_prompt_tokens: number;
  ai_completion_tokens: number;
  calls_total: number;
  calls_minutes: number;
  calls_cost_usd: number;
  orders_total: number;
  connections_connected: number;
  connections_error: number;
  webhooks_unprocessed: number;
  crons_error: number;
}

export interface ActivityPoint {
  day: string;
  messages_in: number;
  messages_out: number;
  ai_replies: number;
  calls: number;
  new_contacts: number;
}

export async function getPlatformOverview(
  from: Date,
  to: Date,
): Promise<PlatformOverview | null> {
  const rows = await rpc<PlatformOverview>('admin_platform_overview', {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  return rows[0] ?? null;
}

export async function getActivitySeries(
  from: Date,
  to: Date,
): Promise<ActivityPoint[]> {
  return rpc<ActivityPoint>('admin_activity_series', {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
}

// ────────────────────────────────────────────────────────────────
// Comercios
// ────────────────────────────────────────────────────────────────

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string | null;
  timezone: string | null;
  created_at: string | null;
  deleted_at: string | null;
  owner_email: string | null;
  owner_name: string | null;
  members: number;
  connections_total: number;
  connections_connected: number;
  connections_broken: number;
  contacts: number;
  conversations: number;
  agents: number;
  agents_active: number;
  last_activity_at: string | null;
  total_count: number;
}

export async function listWorkspaces(opts: {
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: WorkspaceRow[]; total: number }> {
  const rows = await rpc<WorkspaceRow>('admin_workspace_rows', {
    p_search: opts.search?.trim() || null,
    p_limit: opts.limit ?? 50,
    p_offset: opts.offset ?? 0,
  });
  return { rows, total: rows[0]?.total_count ?? 0 };
}

export interface WorkspaceDetail {
  workspace: {
    id: string;
    name: string;
    slug: string | null;
    timezone: string | null;
    created_at: string | null;
    deleted_at: string | null;
    owner_id: string;
  };
  owner: { email: string | null; full_name: string | null } | null;
  members: Array<{
    user_id: string;
    role: string;
    joined_at: string | null;
    allowed_sections: string[] | null;
    email: string | null;
    full_name: string | null;
  }>;
  connections: Array<{
    id: string;
    channel: string;
    label: string | null;
    status: string;
    external_account_id: string | null;
    last_synced_at: string | null;
    last_error: string | null;
    health_can_send: string | null;
    health_review_status: string | null;
    quality_rating: string | null;
    messaging_limit_tier: string | null;
    created_at: string | null;
  }>;
  agents: Array<{
    id: string;
    name: string;
    is_active: boolean;
    model: string | null;
    response_mode: string | null;
    language: string | null;
    created_at: string | null;
  }>;
  counts: {
    contacts: number;
    conversations: number;
    flows: number;
    automations: number;
    broadcasts: number;
    products: number;
    orders: number;
  };
  recentErrors: Array<{
    kind: 'ai' | 'automation' | 'voice';
    at: string | null;
    detail: string | null;
  }>;
}

async function countIn(table: string, workspaceId: string): Promise<number> {
  const { count, error } = await db()
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);
  if (error) return 0;
  return count ?? 0;
}

export async function getWorkspaceDetail(
  id: string,
): Promise<WorkspaceDetail | null> {
  const client = db();

  const { data: ws } = await client
    .from('workspaces')
    .select('id, name, slug, timezone, created_at, deleted_at, owner_id')
    .eq('id', id)
    .maybeSingle();
  if (!ws) return null;
  const workspace = ws as WorkspaceDetail['workspace'];

  const [
    ownerRes,
    membersRes,
    connectionsRes,
    agentsRes,
    contacts,
    conversations,
    flows,
    automations,
    broadcasts,
    products,
    orders,
    aiErrRes,
    autoErrRes,
    voiceErrRes,
  ] = await Promise.all([
    client
      .from('profiles')
      .select('email, full_name')
      .eq('user_id', workspace.owner_id)
      .maybeSingle(),
    client
      .from('workspace_members')
      .select('user_id, role, joined_at, allowed_sections')
      .eq('workspace_id', id),
    safeSelect(
      client,
      'channel_connections',
      'id, channel, label, status, external_account_id, last_synced_at, last_error, health_can_send, health_review_status, quality_rating, messaging_limit_tier, created_at',
    ).eq('workspace_id', id),
    safeSelect(
      client,
      'ai_agents',
      'id, name, is_active, model, response_mode, language, created_at',
    ).eq('workspace_id', id),
    countIn('contacts', id),
    countIn('conversations', id),
    countIn('flows', id),
    countIn('automations', id),
    countIn('broadcasts', id),
    countIn('shopify_products', id),
    countIn('orders', id),
    client
      .from('ai_replies')
      .select('created_at, error, skip_reason')
      .eq('workspace_id', id)
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(5),
    safeSelect(client, 'automation_logs', 'created_at, error_message')
      .eq('workspace_id', id)
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(5),
    safeSelect(client, 'voice_calls', 'created_at, error')
      .eq('workspace_id', id)
      .not('error', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  // Los miembros vienen de dos tablas: la membresía y el perfil (identidad del
  // comercio, no del comprador — permitida).
  const memberRows = (membersRes.data ?? []) as Array<{
    user_id: string;
    role: string;
    joined_at: string | null;
    allowed_sections: string[] | null;
  }>;
  const profileById = new Map<string, { email: string | null; full_name: string | null }>();
  if (memberRows.length) {
    const { data: profiles } = await client
      .from('profiles')
      .select('user_id, email, full_name')
      .in(
        'user_id',
        memberRows.map((m) => m.user_id),
      );
    for (const p of (profiles ?? []) as Array<{
      user_id: string;
      email: string | null;
      full_name: string | null;
    }>) {
      profileById.set(p.user_id, { email: p.email, full_name: p.full_name });
    }
  }

  const recentErrors: WorkspaceDetail['recentErrors'] = [
    ...((aiErrRes.data ?? []) as Array<{ created_at: string; error: string | null }>).map(
      (r) => ({ kind: 'ai' as const, at: r.created_at, detail: r.error }),
    ),
    ...((autoErrRes.data ?? []) as unknown as Array<{
      created_at: string;
      error_message: string | null;
    }>).map((r) => ({
      kind: 'automation' as const,
      at: r.created_at,
      detail: r.error_message,
    })),
    ...((voiceErrRes.data ?? []) as unknown as Array<{ created_at: string; error: string | null }>).map(
      (r) => ({ kind: 'voice' as const, at: r.created_at, detail: r.error }),
    ),
  ]
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
    .slice(0, 10);

  return {
    workspace,
    owner: (ownerRes.data as { email: string | null; full_name: string | null } | null) ?? null,
    members: memberRows.map((m) => ({
      ...m,
      email: profileById.get(m.user_id)?.email ?? null,
      full_name: profileById.get(m.user_id)?.full_name ?? null,
    })),
    connections: (connectionsRes.data ?? []) as unknown as WorkspaceDetail['connections'],
    agents: (agentsRes.data ?? []) as unknown as WorkspaceDetail['agents'],
    counts: {
      contacts,
      conversations,
      flows,
      automations,
      broadcasts,
      products,
      orders,
    },
    recentErrors,
  };
}

// ────────────────────────────────────────────────────────────────
// Usuarios
// ────────────────────────────────────────────────────────────────

export interface UserRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  locale: string | null;
  timezone: string | null;
  created_at: string | null;
  terms_version: string | null;
  terms_accepted_at: string | null;
  workspaces: Array<{ id: string; name: string; role: string; owner: boolean }>;
  total_count: number;
}

export async function listUsers(opts: {
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: UserRow[]; total: number }> {
  const rows = await rpc<UserRow>('admin_user_rows', {
    p_search: opts.search?.trim() || null,
    p_limit: opts.limit ?? 50,
    p_offset: opts.offset ?? 0,
  });
  return { rows, total: rows[0]?.total_count ?? 0 };
}

// ────────────────────────────────────────────────────────────────
// Uso y costo
// ────────────────────────────────────────────────────────────────

export interface UsageRow {
  workspace_id: string;
  workspace_name: string;
  owner_email: string | null;
  messages_out: number;
  messages_in: number;
  ai_sent: number;
  ai_skipped: number;
  ai_failed: number;
  prompt_tokens: number;
  completion_tokens: number;
  calls: number;
  call_minutes: number;
  call_cost_usd: number;
  orders: number;
  /** Tokens desglosados por modelo — las tarifas difieren hasta 10x. */
  tokens_by_model: Record<string, { prompt: number; completion: number }>;
}

export async function listUsage(from: Date, to: Date): Promise<UsageRow[]> {
  return rpc<UsageRow>('admin_usage_rows', {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
}

// ────────────────────────────────────────────────────────────────
// Canales (salud de conexiones, toda la plataforma)
// ────────────────────────────────────────────────────────────────

export interface ChannelRow {
  id: string;
  workspace_id: string;
  workspace_name: string | null;
  channel: string;
  label: string | null;
  status: string;
  external_account_id: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  health_can_send: string | null;
  health_review_status: string | null;
  health_blockers: unknown;
  quality_rating: string | null;
  messaging_limit_tier: string | null;
  created_at: string | null;
}

export async function listChannels(opts: {
  channel?: string;
  status?: string;
}): Promise<ChannelRow[]> {
  const columns =
    'id, workspace_id, channel, label, status, external_account_id, last_synced_at, last_error, health_can_send, health_review_status, health_blockers, quality_rating, messaging_limit_tier, created_at';
  let q = safeSelect(db(), 'channel_connections', columns).order('updated_at', {
    ascending: false,
  });
  if (opts.channel) q = q.eq('channel', opts.channel);
  if (opts.status) q = q.eq('status', opts.status);

  const { data, error } = await q.limit(500);
  if (error) throw new Error(`[admin] listChannels: ${error.message}`);
  const rows = (data ?? []) as unknown as Omit<ChannelRow, 'workspace_name'>[];

  const names = await workspaceNames(rows.map((r) => r.workspace_id));
  return rows.map((r) => ({ ...r, workspace_name: names.get(r.workspace_id) ?? null }));
}

/** Nombres de comercio para un lote de ids — para no mostrar UUIDs pelados. */
export async function workspaceNames(
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const { data } = await db().from('workspaces').select('id, name').in('id', unique);
  for (const w of (data ?? []) as Array<{ id: string; name: string }>) {
    out.set(w.id, w.name);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────
// Operación (crons + webhooks)
// ────────────────────────────────────────────────────────────────

export interface CronRow {
  name: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  error: string | null;
  runs_24h: number;
  errors_24h: number;
}

export interface OpsStatus {
  crons: CronRow[];
  webhooks: {
    unprocessed: number;
    failing: Array<{
      id: string;
      provider: string;
      received_at: string;
      attempts: number;
      last_error: string | null;
    }>;
    byProvider: Array<{ provider: string; unprocessed: number }>;
  };
}

export async function getOpsStatus(): Promise<OpsStatus> {
  const client = db();
  const crons = await rpc<CronRow>('admin_cron_health', {});

  const [{ count: unprocessed }, failingRes] = await Promise.all([
    client
      .from('webhook_events_raw')
      .select('id', { count: 'exact', head: true })
      .is('processed_at', null),
    safeSelect(
      client,
      'webhook_events_raw',
      'id, provider, received_at, attempts, last_error',
    )
      .is('processed_at', null)
      .order('received_at', { ascending: false })
      .limit(50),
  ]);

  const failing = (failingRes.data ?? []) as unknown as OpsStatus['webhooks']['failing'];
  const byProvider = new Map<string, number>();
  for (const w of failing) {
    byProvider.set(w.provider, (byProvider.get(w.provider) ?? 0) + 1);
  }

  return {
    crons,
    webhooks: {
      unprocessed: unprocessed ?? 0,
      failing,
      byProvider: [...byProvider.entries()].map(([provider, n]) => ({
        provider,
        unprocessed: n,
      })),
    },
  };
}

// ────────────────────────────────────────────────────────────────
// Auditoría y lista de espera
// ────────────────────────────────────────────────────────────────

export interface AuditRow {
  id: number;
  actor_email: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  meta: Record<string, unknown>;
  ip: string | null;
  created_at: string;
}

export async function listAudit(opts: {
  limit?: number;
  offset?: number;
  actor?: string;
}): Promise<AuditRow[]> {
  let q = db()
    .from('admin_audit_log')
    .select('id, actor_email, action, target_type, target_id, meta, ip, created_at')
    .order('created_at', { ascending: false });
  if (opts.actor) q = q.eq('actor_email', opts.actor);
  const { data, error } = await q.range(
    opts.offset ?? 0,
    (opts.offset ?? 0) + (opts.limit ?? 100) - 1,
  );
  if (error) throw new Error(`[admin] listAudit: ${error.message}`);
  return (data ?? []) as AuditRow[];
}

export interface WaitlistRow {
  id: string;
  email: string;
  name: string | null;
  source: string | null;
  created_at: string;
}

export async function listWaitlist(opts: {
  limit?: number;
  offset?: number;
}): Promise<{ rows: WaitlistRow[]; total: number }> {
  const { data, error, count } = await db()
    .from('waitlist')
    .select('id, email, name, source, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 100) - 1);
  if (error) throw new Error(`[admin] listWaitlist: ${error.message}`);
  return { rows: (data ?? []) as WaitlistRow[], total: count ?? 0 };
}
