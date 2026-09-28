import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveShortId } from '@/lib/short-id';
import { collectPlatformIssues, collectWorkspaceIssues, type Issue } from '@/lib/health/issues';
import { getFeatureFlags, getWorkspaceOverrides } from './feature-flags';
import { assertMetadataOnly } from './pii';
import { selectAll } from '@/lib/db/paginate';
import { workspaceWalletSummary } from './workspace-wallet';
import { getPendingWalletReconciliation } from './wallet-pending';

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

/**
 * `select()` con la barrera de privacidad puesta delante.
 *
 * Exportado para que cualquier lector nuevo del panel (por ejemplo
 * `llaves.ts`) pase por la misma barrera en vez de escribir su propio
 * `.from().select()` sin ella.
 */
export function safeSelect(client: SupabaseClient, table: string, columns: string) {
  assertMetadataOnly(table, columns);
  return client.from(table).select(columns);
}

async function allConnectionMetadata(client: SupabaseClient, table: string, columns: string, orderBy = 'id') {
  assertMetadataOnly(table, columns);
  return { data: await selectAll(client, table, q => q, { select: columns, orderBy, strict: true }), error: null };
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
  /** Lo que está roto en este comercio, ahora mismo. */
  issues: Issue[];
}

export async function listWorkspaces(opts: {
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: WorkspaceRow[]; total: number }> {
  // Los problemas se traen de una sola consulta para toda la plataforma y se
  // pegan en memoria: preguntarlos por comercio serían seis consultas por fila.
  const [rows, issues] = await Promise.all([
    rpc<WorkspaceRow>('admin_workspace_rows', {
      p_search: opts.search?.trim() || null,
      p_limit: opts.limit ?? 50,
      p_offset: opts.offset ?? 0,
    }),
    collectPlatformIssues(db()),
  ]);

  const withIssues = rows.map((r) => ({ ...r, issues: issues.get(r.id) ?? [] }));
  return { rows: withIssues, total: rows[0]?.total_count ?? 0 };
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
    /** Cobro manual: NULL = activa. Ver lib/workspaces/suspension. */
    suspended_at: string | null;
    /** Nota interna del equipo. No se le muestra al comercio. */
    suspended_reason: string | null;
    /** Motor: NULL = anda. Muda hacia afuera pero con panel. Ver lib/workspaces/motor. */
    motor_apagado_at: string | null;
    /** Lo que el comercio contestó sobre las ventas que cierra hablando y
     *  carga a mano (migración 229). NULL = no contestó. El pedido cargado a
     *  mano en Shopify sí se deduce (`source_name = shopify_draft_order`); esto
     *  cubre la venta que nunca llega a Shopify — Dropi, planilla, efectivo. */
    ventas_a_mano: 'seguido' | 'a_veces' | 'casi_nunca' | null;
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
  /**
   * Lo que está roto, con el mismo criterio que ve el comercio en su Inicio.
   * No es lo mismo que `recentErrors`: los últimos errores son un historial,
   * esto es el estado — una corrida trabada en "parcial" o una plantilla
   * rechazada no dejan ninguna línea de error y no aparecían por ningún lado.
   */
  issues: Issue[];
  /** Funcionalidades: el valor global y la excepción de este comercio. */
  features: {
    global: Record<string, boolean>;
    overrides: Record<string, boolean>;
  };
  /**
   * La billetera de este comercio, con las últimas líneas del libro.
   *
   * El saldo suelto no alcanza para entender una queja: "me quedé sin saldo"
   * se contesta mirando en qué se le fue, y eso son los movimientos. Van las
   * últimas 20 — más que eso ya es una auditoría y no una ficha.
   */
  billetera: {
    saldoCentavos: number;
    disponibleCentavos: number;
    moneda: string;
    sinSaldo: boolean;
    bloqueaSinSaldo: boolean;
    movimientos: Array<{
      id: string;
      creadoEn: string;
      tipo: string;
      concepto: string;
      centavos: number;
      saldoDespuesCentavos: number;
      cantidad: number | null;
      unidad: string | null;
    }>;
  };
}

async function countIn(table: string, workspaceId: string): Promise<number> {
  const { count, error } = await db()
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);
  if (error) throw new Error(`workspace_count_unavailable:${table}`);
  return count ?? 0;
}

export async function getWorkspaceDetail(
  rawId: string,
): Promise<WorkspaceDetail | null> {
  const client = db();
  // El parámetro puede venir como short id (8) o UUID completo; resolvemos una
  // vez al UUID y el resto de las subconsultas (por workspace_id) usan ese.
  const id = await resolveShortId(client, 'workspaces', rawId);

  // Render despliega el código al empujar y las migraciones se aplican a mano
  // después, así que hay una ventana en la que una columna nueva no existe
  // todavía — y pedirla sin más deja esta pantalla en 404 justo cuando el
  // equipo la necesita para mirar qué pasó. Las nuevas van acá, en orden de
  // llegada, y se van soltando de a una hasta que la consulta entra:
  // `motor_apagado_at` llegó con la 196 y `ventas_a_mano` con la 229.
  const COLUMNAS =
    'id, name, slug, timezone, created_at, deleted_at, owner_id, suspended_at, suspended_reason';
  const NUEVAS = ['motor_apagado_at', 'ventas_a_mano'];
  let ws: unknown = null;
  for (let n = NUEVAS.length; n >= 0; n--) {
    const res = await client
      .from('workspaces')
      .select([COLUMNAS, ...NUEVAS.slice(0, n)].join(', '))
      .eq('id', id)
      .maybeSingle();
    if (!res.error) {
      ws = res.data;
      break;
    }
  }
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
    issues,
    globalFlags,
    overrides,
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
    collectWorkspaceIssues(client, id),
    getFeatureFlags(client, null, { strict: true }),
    getWorkspaceOverrides(client, id, { strict: true }),
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

  // ── Billetera ──
  // Va fuera del Promise.all de arriba a propósito: son dos consultas chicas y
  // meterlas ahí obligaba a renumerar la desestructuración entera, que es
  // justo el tipo de cambio que rompe un archivo largo sin que se note.
  const [billeteraRes, movimientosRes, suscripcionRes] = await Promise.all([
    client
      .from('wallet_accounts')
      .select('saldo_centavos, reservado_centavos, moneda')
      .eq('workspace_id', id)
      .maybeSingle(),
    client
      .from('wallet_movimientos')
      .select('id, creado_en, tipo, concepto, centavos, saldo_despues_centavos, cantidad, unidad')
      .eq('workspace_id', id)
      .order('creado_en', { ascending: false })
      .limit(20),
    safeSelect(client, 'workspace_subscriptions', 'estado, modelo_cobro')
      .eq('workspace_id', id)
      .maybeSingle(),
  ]);
  if (billeteraRes.error || movimientosRes.error || suscripcionRes.error) {
    throw new Error('workspace_wallet_unavailable');
  }
  const cuentaBilletera = billeteraRes.data as {
    saldo_centavos?: number;
    reservado_centavos?: number;
    moneda?: string;
  } | null;

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
    billetera: {
      ...workspaceWalletSummary(
        cuentaBilletera,
        suscripcionRes.data as { estado?: string; modelo_cobro?: string } | null,
      ),
      movimientos: ((movimientosRes.data ?? []) as unknown as Array<{
        id: string;
        creado_en: string;
        tipo: string;
        concepto: string;
        centavos: number;
        saldo_despues_centavos: number;
        cantidad: number | null;
        unidad: string | null;
      }>).map((m) => ({
        id: m.id,
        creadoEn: m.creado_en,
        tipo: m.tipo,
        concepto: m.concepto,
        centavos: Number(m.centavos ?? 0),
        saldoDespuesCentavos: Number(m.saldo_despues_centavos ?? 0),
        cantidad: m.cantidad === null ? null : Number(m.cantidad),
        unidad: m.unidad,
      })),
    },
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
    issues,
    features: { global: globalFlags, overrides },
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
  /**
   * Los mismos tokens, cortados por quién paga (`ai_replies.key_source`:
   * `platform` o la clave del propio comercio). Es la pregunta entera de
   * /admin/ia, que antes la contestaba con su propio barrido y su propia tarifa.
   */
  tokens_by_source: Record<
    string,
    { prompt: number; completion: number; calls: number }
  >;
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
  sync_pending?: boolean;
  sync_history_unavailable?: boolean;
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
  /**
   * `config.health_status` del WABA. Es el campo que la app usa para decidir
   * "WhatsApp bloqueado" (ver src/lib/health/issues.ts) y el panel ni lo pedía.
   */
  health_status: string | null;
  /**
   * Cuándo llegó algo por PUSH por última vez.
   *
   * Es lo que contesta "¿el webhook está llegando?" sin adivinar. Antes esa
   * pregunta sólo se podía responder mirando si aparecen mensajes, y eso no
   * distingue "no llega el webhook" de "no escribió nadie" — que es el error
   * que dejó la suscripción de Meta apuntando a un dominio muerto seis días.
   *
   * También es la puerta para espaciar un recorrido periódico: sin este dato,
   * bajarle la frecuencia a Gmail o a Mercado Libre es una apuesta.
   */
  last_push_at: string | null;
  quality_rating: string | null;
  messaging_limit_tier: string | null;
  created_at: string | null;
}

/**
 * Las conexiones, y la lista de tipos que existen de verdad.
 *
 * `channels` sale de los datos y no de una constante escrita a mano en la
 * pantalla. La lista a mano ya se había quedado atrás: no incluía `webchat`
 * —un canal vivo desde la migración 171— ni `meta_pixel` ni `stripe`, así que
 * esas filas aparecían en la tabla pero no se podían filtrar, y nada fallaba
 * para avisarlo. Derivándola, el próximo canal aparece solo.
 */
export async function listChannels(opts: {
  channel?: string;
  status?: string;
}): Promise<{ rows: ChannelRow[]; channels: string[]; statuses: string[] }> {
  // `config` trae `health_status`, que es lo único de ese jsonb que mira el
  // panel. No es un secreto (los secretos viven en `secrets`, que la barrera
  // bloquea), pero se recorta acá para no arrastrar el resto al navegador.
  const columns =
    'id, workspace_id, channel, label, status, external_account_id, last_synced_at, last_error, health_can_send, health_review_status, health_blockers, quality_rating, messaging_limit_tier, created_at, config';
  const { data } = await allConnectionMetadata(db(), 'channel_connections', columns);
  const rows = (data ?? []) as unknown as Array<
    Omit<ChannelRow, 'workspace_name' | 'health_status' | 'last_push_at'> & {
      config?: { health_status?: string | null; health_sync_error?: string | null; last_push_at?: string | null; dm_backfill_complete?: boolean; comment_sync_complete?: boolean; poll_sync_complete?: boolean; sync_requested_at?: string } | null;
    }
  >;

  const mensajeria = rows.map(({ config, ...r }) => ({
    ...r,
    health_status: config?.health_status ?? null,
    last_error: r.last_error ?? config?.health_sync_error ?? null,
    last_push_at: config?.last_push_at ?? null,
    sync_pending: config?.poll_sync_complete === false || config?.dm_backfill_complete === false || config?.comment_sync_complete === false ||
      Boolean(config?.sync_requested_at && (!r.last_synced_at || config.sync_requested_at > r.last_synced_at)),
    sync_history_unavailable: ['whatsapp', 'webchat', 'voice'].includes(r.channel),
  }));

  // La otra mitad de Riverz. Las tiendas y los medios de pago viven en tablas
  // distintas de los canales de mensajería, y el panel no las miraba: toda la
  // parte de comercio —Shopify, Tiendanube, WooCommerce, Mercado Pago,
  // Klaviyo— no tenía salud a nivel plataforma, aunque `issues.ts` ya supiera
  // leer la primera de esas tablas.
  const comercio = await listCommerceConnections();

  // Los catálogos se arman SIN los filtros: si no, elegir un canal dejaría la
  // lista con una sola opción y sin forma de volver.
  const crudos = rows;

  const channels = [
    ...new Set([...crudos.map((r) => r.channel), ...comercio.map((r) => r.channel)]),
  ].sort();

  // Los estados también salen de los datos. Las tiendas no usan los mismos que
  // los canales de mensajería —su CHECK admite `active` y `uninstalled`— así
  // que la lista escrita a mano no los ofrecía y no había forma de filtrarlos.
  const statuses = [
    ...new Set([...crudos.map((r) => r.status), ...comercio.map((r) => r.status)]),
  ]
    .filter(Boolean)
    .sort();

  const filtradas = comercio.filter(
    (f) =>
      (!opts.channel || f.channel === opts.channel) &&
      (!opts.status || f.status === opts.status),
  );

  const todas = [...mensajeria.filter(r => (!opts.channel || r.channel === opts.channel) && (!opts.status || r.status === opts.status)), ...filtradas];
  const names = await workspaceNames(todas.map((r) => r.workspace_id));
  return {
    rows: todas.map((r) => ({
      ...r,
      workspace_name: names.get(r.workspace_id) ?? null,
    })),
    channels,
    statuses,
  };
}

/**
 * Canales que no son de mensajería, normalizados a la misma fila.
 *
 * Devuelve TODO y el filtro lo aplica quien llama: la lista completa es lo que
 * alimenta el catálogo de tipos del selector.
 */
async function listCommerceConnections(): Promise<Omit<ChannelRow, 'workspace_name'>[]> {
  const client = db();

  const [tiendas, integraciones, dropi] = await Promise.all([
    allConnectionMetadata(
      client,
      'shopify_connections',
      'id, workspace_id, platform, shop_domain, status, currency, created_at, updated_at, sync_state',
    ),
    allConnectionMetadata(
      client,
      'workspace_integrations',
      'id, workspace_id, provider, external_account_id, expires_at, is_active, created_at, updated_at',
    ),
    // Dropi (entrega contra reembolso) vive en su propia tabla, con
    // `workspace_id` de clave primaria y sin columna `id`. Faltaba: era la
    // única conexión de un comercio que el panel no veía de ninguna forma.
    allConnectionMetadata(
      client,
      'dropi_connections',
      'workspace_id, status, created_at, updated_at',
      'workspace_id',
    ),
  ]);

  const vacio = {
    label: null,
    last_synced_at: null,
    last_error: null,
    health_can_send: null,
    health_review_status: null,
    health_blockers: null,
    health_status: null,
    // Las tiendas y los medios de pago no tienen webhook de mensajería: acá
    // el sello no aplica.
    last_push_at: null,
    quality_rating: null,
    messaging_limit_tier: null,
  };

  const filas: Omit<ChannelRow, 'workspace_name'>[] = [
    ...((tiendas.data ?? []) as unknown as Array<{
      sync_state?: { mark?: string; complete?: boolean; error?: string };
      id: string;
      workspace_id: string;
      platform: string | null;
      shop_domain: string;
      status: string;
      currency: string | null;
      created_at: string | null;
    }>).map((s) => ({
      ...vacio,
      id: s.id,
      workspace_id: s.workspace_id,
      channel: s.platform ?? 'shopify',
      status: s.status,
      external_account_id: s.shop_domain,
      label: s.currency,
      last_synced_at: s.sync_state?.mark ?? null,
      last_error: s.sync_state?.error ?? null,
      sync_pending: s.status !== 'uninstalled' && s.sync_state?.complete !== true,
      created_at: s.created_at,
    })),
    ...((integraciones.data ?? []) as unknown as Array<{
      id: string;
      workspace_id: string;
      provider: string;
      external_account_id: string | null;
      expires_at: string | null;
      is_active: boolean;
      created_at: string | null;
    }>).map((i) => ({
      ...vacio,
      id: i.id,
      workspace_id: i.workspace_id,
      channel: i.provider,
      // Un token vencido es una conexión rota aunque la fila diga otra cosa: es
      // lo que hace que dejen de entrar los pagos rechazados de Mercado Pago.
      status:
        i.is_active === false ? 'disconnected' :
          i.expires_at && Date.parse(i.expires_at) <= Date.now() ? 'expired' : 'connected',
      external_account_id: i.external_account_id,
      created_at: i.created_at,
    })),
    ...((dropi.data ?? []) as unknown as Array<{
      workspace_id: string;
      status: string;
      created_at: string | null;
    }>).map((d) => ({
      ...vacio,
      // Sin columna `id`: la clave primaria de la tabla es el comercio.
      id: `dropi-${d.workspace_id}`,
      workspace_id: d.workspace_id,
      channel: 'dropi',
      status: d.status,
      external_account_id: null,
      created_at: d.created_at,
    })),
  ];

  return filas;
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
  wallet: { pending: number; reservedCents: number };
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

/**
 * La última corrida de cada trabajo, con sus conteos de 24 h.
 *
 * Una sola función para todo el que necesite esto: el panel de operación, el
 * home, `/api/health/crons` y la herramienta `cron_estado` del MCP. Antes cada
 * uno tenía su propio cálculo y se contradecían entre sí.
 */
export async function getCronHealth(): Promise<CronRow[]> {
  return rpc<CronRow>('admin_cron_health', {});
}

export async function getOpsStatus(): Promise<OpsStatus> {
  const client = db();
  const columns = 'id, provider, received_at, attempts, last_error';
  assertMetadataOnly('webhook_events_raw', columns);
  const [crons, pending, wallet] = await Promise.all([
    getCronHealth(),
    selectAll<OpsStatus['webhooks']['failing'][number]>(
      client,
      'webhook_events_raw',
      q => q.is('processed_at', null),
      { select: columns, strict: true },
    ),
    getPendingWalletReconciliation(client),
  ]);

  const failing = [...pending]
    .sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at))
    .slice(0, 50);
  const byProvider = new Map<string, number>();
  for (const w of pending) {
    byProvider.set(w.provider, (byProvider.get(w.provider) ?? 0) + 1);
  }

  return {
    crons,
    wallet,
    webhooks: {
      unprocessed: pending.length,
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

/**
 * Lo que un agente hizo sobre la cuenta de un comercio, vía MCP.
 *
 * Es el otro libro de actas. `admin_audit_log` (migración 124) anota lo que el
 * equipo mira y cambia DESDE el panel; `platform_audit_log` (migración 150)
 * anota lo que el servidor MCP hace sobre datos de un comercio, lecturas
 * incluidas. La migración 150 dice en su propio comentario que "se lee desde
 * /admin" — y hasta acá no lo leía nadie: el único uso de la tabla en todo el
 * repo era el INSERT.
 */
export interface PlatformAuditRow {
  id: number;
  workspace_id: string | null;
  workspace_name: string | null;
  actor: string;
  tool: string;
  risk: string;
  ok: boolean;
  summary: string | null;
  created_at: string;
}

export async function listPlatformAudit(opts: {
  limit?: number;
  offset?: number;
  actor?: string;
}): Promise<PlatformAuditRow[]> {
  // `args` no se devuelve: aunque desde ahora se guarda con los campos
  // sensibles ocultos, las filas viejas se escribieron con el teléfono y el
  // texto del mensaje adentro, y esto es una pantalla de solo-metadatos.
  let q = db()
    .from('platform_audit_log')
    .select('id, workspace_id, actor, tool, risk, ok, summary, created_at')
    .order('created_at', { ascending: false });
  if (opts.actor) q = q.eq('actor', opts.actor);
  const { data, error } = await q.range(
    opts.offset ?? 0,
    (opts.offset ?? 0) + (opts.limit ?? 100) - 1,
  );
  if (error) throw new Error(`[admin] listPlatformAudit: ${error.message}`);

  const rows = (data ?? []) as Omit<PlatformAuditRow, 'workspace_name'>[];
  const names = await workspaceNames(
    rows.map((r) => r.workspace_id).filter((v): v is string => Boolean(v)),
  );
  return rows.map((r) => ({
    ...r,
    workspace_name: r.workspace_id ? (names.get(r.workspace_id) ?? null) : null,
  }));
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
