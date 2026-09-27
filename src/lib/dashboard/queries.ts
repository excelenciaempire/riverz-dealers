import type { SupabaseClient } from '@supabase/supabase-js'
import {
  bucketGranularity,
  bucketKeyOf,
  rangeBucketKeys,
  type DateRange,
} from './date-utils'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  ResponseTimeBucket,
  ResponseTimeReport,
  ResponseTimeSummary,
} from './types'
import type { TFn } from '@/lib/i18n/translate'
import { contactLabel } from '@/lib/contacts/display-name'

// ------------------------------------------------------------
// All client-side aggregation. RLS scopes every query to the
// signed-in user's workspace automatically, so we never pass user_id
// explicitly here. Every loader takes an explicit [start, end) DateRange
// (resolved from the dashboard's date-range filter, in workspace tz) plus a
// `prev` window for deltas. Perf is fine at our scale (low thousands of
// messages); heavy aggregations would move to SQL RPCs if a tenant grows.
// ------------------------------------------------------------

type DB = SupabaseClient

const iso = (d: Date) => d.toISOString()

/**
 * Fetch ALL rows of a query, paging past PostgREST's hard 1000-row cap.
 * Without this, any chart that reads message ROWS (series, channel mix,
 * response time) silently truncates at 1000 and stops matching the KPI
 * cards (which use exact head counts) — e.g. a 30-day range with 1.4k
 * messages would chart only the first 1000. We page in 1000s until a short
 * page signals the end. Safe at our scale (a few pages); heavy ranges would
 * move to a SQL aggregate RPC.
 */
async function fetchAllRows<T>(
  make: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; from < 500_000; from += PAGE) {
    const { data, error } = await make(from, from + PAGE - 1)
    if (error) throw error as Error
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

/**
 * Recorte explícito por cuenta, para quien no viene con RLS.
 *
 * El panel usa el cliente del navegador: RLS ya limita cada consulta al
 * workspace del usuario, así que pasa `null` y nada cambia. El MCP y el
 * Operator usan la llave de servicio, que ve TODA la base — sin este alcance
 * sumarían las métricas de todos los comercios en una sola cifra.
 *
 * Existe para que el panel y el agente puedan compartir esta función en vez de
 * escribir dos veces la misma cuenta. Cuando eran dos, se contradecían: la de
 * acá cuenta salientes con `neq customer` y paginada, la del MCP contaba sólo
 * `agent|bot` y sin paginar.
 */
export type MetricsScope = { workspaceId: string } | null

/**
 * Consulta de mensajes ya recortada. El tipado de postgrest-js no puede
 * inferir un `select` armado con plantilla, así que se declara acá lo único
 * que estas consultas encadenan y se castea una vez.
 */
interface MsgQuery<T>
  extends PromiseLike<{
    data: T[] | null
    count?: number | null
    error: { message?: string } | null
  }> {
  eq(column: string, value: string): MsgQuery<T>
  neq(column: string, value: string): MsgQuery<T>
  gte(column: string, value: string): MsgQuery<T>
  lt(column: string, value: string): MsgQuery<T>
  range(from: number, to: number): MsgQuery<T>
  order(column: string, options?: { ascending?: boolean }): MsgQuery<T>
}

/**
 * `messages` no tiene `workspace_id`: cuelga de su conversación. Con alcance,
 * el recorte va por un join interno sobre `conversations`; sin alcance, la
 * consulta queda exactamente como estaba (RLS hace el trabajo).
 */
function messagesQuery<T = never>(
  db: DB,
  scope: MetricsScope,
  columns: string,
  count?: boolean,
): MsgQuery<T> {
  const opts = count ? ({ count: 'exact', head: true } as const) : undefined
  const q = scope
    ? db
        .from('messages')
        .select(`${columns}, conversations!inner(workspace_id)`, opts)
        .eq('conversations.workspace_id', scope.workspaceId)
    : db.from('messages').select(columns, opts)
  return q as unknown as MsgQuery<T>
}

/** Recorta una tabla que sí tiene `workspace_id` propio. */
function scoped<T>(q: T, scope: MetricsScope): T {
  return scope ? (q as { eq(column: string, value: string): T }).eq('workspace_id', scope.workspaceId) : q
}

// --- 1. Metric cards ---------------------------------------------------

export async function loadMetrics(
  db: DB,
  tz: string,
  range: DateRange,
  prev: DateRange,
  scope: MetricsScope = null,
): Promise<MetricsBundle> {
  const s = iso(range.start)
  const e = iso(range.end)
  const ps = iso(prev.start)
  const pe = iso(prev.end)

  // Filas de mensajes del rango actual y del anterior. Se usan para TRES cosas
  // a la vez (conversaciones del período, mezcla por canal y el delta), así que
  // se traen una sola vez. Paginadas: sin esto cualquier rango con más de 1000
  // mensajes se truncaría y dejaría de cuadrar con las tarjetas de conteo.
  type MixRow = {
    conversation_id?: string | null
    channel?: string | null
    sender_type?: string | null
  }

  const [
    newContactsCur,
    newContactsPrev,
    resolvedCur,
    resolvedPrev,
    connections,
    rangeRows,
    prevRows,
  ] = await Promise.all([
    scoped(db.from('contacts').select('id', { count: 'exact', head: true }), scope).gte('created_at', s).lt('created_at', e),
    scoped(db.from('contacts').select('id', { count: 'exact', head: true }), scope).gte('created_at', ps).lt('created_at', pe),
    // "Resueltas" — gate on closed_at (set by code only when status actually
    // flips to closed), not updated_at which the BEFORE UPDATE trigger bumps
    // on every unrelated edit.
    scoped(db.from('conversations').select('id', { count: 'exact', head: true }), scope).eq('status', 'closed').gte('closed_at', s).lt('closed_at', e),
    scoped(db.from('conversations').select('id', { count: 'exact', head: true }), scope).eq('status', 'closed').gte('closed_at', ps).lt('closed_at', pe),
    // Canales conectados del workspace: siembran la mezcla por canal para que
    // un canal sin tráfico en la ventana aparezca en 0 y no desaparezca de la
    // tarjeta (antes "no se mostraba WhatsApp" cuando el rango no lo incluía).
    scoped(db.from('channel_connections').select('channel'), scope).eq('status', 'connected'),
    fetchAllRows<MixRow>((from, to) =>
      messagesQuery<MixRow>(db, scope, 'conversation_id, channel, sender_type')
        .gte('created_at', s)
        .lt('created_at', e)
        .order('created_at').order('id')
        .range(from, to),
    ),
    fetchAllRows<MixRow>((from, to) =>
      messagesQuery<MixRow>(db, scope, 'conversation_id, sender_type')
        .gte('created_at', ps)
        .lt('created_at', pe)
        .order('created_at').order('id')
        .range(from, to),
    ),
  ])

  // A failed query is unavailable data, never a real zero. Message KPIs and
  // channel volumes share one paginated snapshot instead of separate counts.
  for (const result of [newContactsCur, newContactsPrev, resolvedCur, resolvedPrev, connections]) {
    if (result.error) throw result.error
  }
  const received = (rows: MixRow[]) => rows.filter(row => row.sender_type === 'customer').length
  const receivedCur = received(rangeRows), receivedPrev = received(prevRows)

  // Conversaciones DEL PERÍODO: las que tuvieron al menos un mensaje dentro del
  // rango. Antes esta tarjeta era una foto instantánea de "abiertas ahora", que
  // ignoraba el filtro de fechas y no cuadraba con el resto del panel.
  const convIds = new Set<string>()
  const mix = new Map<string, { inbound: number; outbound: number }>()
  for (const row of (connections.data ?? []) as { channel?: string | null }[]) {
    if (row.channel) mix.set(row.channel, { inbound: 0, outbound: 0 })
  }
  for (const r of rangeRows) {
    if (r.conversation_id) convIds.add(r.conversation_id)
    const ch = r.channel ?? 'unknown'
    const m = mix.get(ch) ?? { inbound: 0, outbound: 0 }
    if (r.sender_type === 'customer') m.inbound++
    else m.outbound++
    mix.set(ch, m)
  }
  const prevConvIds = new Set<string>()
  for (const r of prevRows) if (r.conversation_id) prevConvIds.add(r.conversation_id)

  const channelMix = [...mix.entries()]
    .map(([channel, v]) => ({ channel, inbound: v.inbound, outbound: v.outbound }))
    // Volumen desc; los canales en cero caen al final en orden estable para que
    // la lista no baile entre refrescos.
    .sort(
      (a, b) =>
        b.inbound + b.outbound - (a.inbound + a.outbound) ||
        a.channel.localeCompare(b.channel),
    )

  return {
    conversations: { current: convIds.size, previous: prevConvIds.size },
    newContacts: { current: newContactsCur.count ?? 0, previous: newContactsPrev.count ?? 0 },
    resolved: { current: resolvedCur.count ?? 0, previous: resolvedPrev.count ?? 0 },
    messagesSent: { current: rangeRows.length - receivedCur, previous: prevRows.length - receivedPrev },
    messagesReceived: { current: receivedCur, previous: receivedPrev },
    channelMix,
  }
}

// --- 2. Conversations over time ---------------------------------------

export async function loadConversationsSeries(
  db: DB,
  tz: string,
  range: DateRange,
): Promise<ConversationsSeriesPoint[]> {
  // Paginated: a 30-day range can exceed PostgREST's 1000-row cap, which
  // would chart only the first 1000 messages and undercount the curve.
  const data = await fetchAllRows<{ created_at: string; sender_type: string }>(
    (from, to) =>
      db
        .from('messages')
        .select('created_at, sender_type')
        .gte('created_at', iso(range.start))
        .lt('created_at', iso(range.end))
        .order('created_at', { ascending: true })
        .range(from, to),
  )

  // Hourly buckets for short ranges (Hoy/Ayer) so the curve is meaningful;
  // daily otherwise. Seed every bucket so empty ones render as 0.
  const gran = bucketGranularity(range)
  const keys = rangeBucketKeys(tz, range, gran)
  const buckets = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of keys) buckets.set(k, { incoming: 0, outgoing: 0 })

  for (const row of (data ?? []) as { created_at: string; sender_type: string }[]) {
    const key = bucketKeyOf(tz, row.created_at, gran)
    const bucket = buckets.get(key)
    if (!bucket) continue
    if (row.sender_type === 'customer') bucket.incoming += 1
    else bucket.outgoing += 1 // agent + bot both count as outgoing
  }

  return keys.map((day) => ({ day, ...(buckets.get(day) ?? { incoming: 0, outgoing: 0 }) }))
}

// --- 3. Response time by day of week ----------------------------------

/**
 * Silencio a partir del cual un mensaje del cliente empieza una consulta
 * nueva en vez de continuar la anterior. 24 h es la misma ventana de
 * atención que usa WhatsApp, así que coincide con lo que el comercio ve.
 */
const SESSION_GAP_MS = 24 * 60 * 60 * 1000

/**
 * Salidas que Riverz manda POR SU CUENTA, no porque el cliente haya
 * preguntado algo: el seguimiento a un cliente que se quedó callado, una
 * campaña, un DM de captación, un aviso de pedido. Si contaran como
 * respuesta, un "gracias" que no necesitaba contestación quedaría
 * "respondido" días después y fabricaría una espera enorme.
 */
const PROACTIVE_ORIGINS = new Set(['ai_followup', 'broadcast', 'ig_outreach', 'order_update'])

export async function loadResponseTime(
  db: DB,
  tz: string,
  range: DateRange,
  prev: DateRange,
): Promise<ResponseTimeReport> {
  // Fetch the union of the current + previous windows in one shot, then
  // classify each "first inbound → first subsequent outbound" pair into the
  // period its customer message falls in. Day-of-week buckets reflect the
  // CURRENT range only; prev feeds the comparison average.
  const fetchStart = iso(new Date(Math.min(range.start.getTime(), prev.start.getTime())))
  const fetchEnd = iso(new Date(Math.max(range.end.getTime(), prev.end.getTime())))
  // Paginated: ordered by (conversation_id, created_at) so the customer→reply
  // pairing below sees complete conversations even past the 1000-row cap.
  const [rows, openedRows] = await Promise.all([
    fetchAllRows<{
      conversation_id: string
      sender_type: string
      created_at: string
      content_type: string | null
      origin: string | null
    }>((from, to) =>
      db
        .from('messages')
        .select('conversation_id, sender_type, created_at, content_type, origin')
        .gte('created_at', fetchStart)
        .lt('created_at', fetchEnd)
        .order('conversation_id', { ascending: true })
        .order('created_at', { ascending: true })
        .range(from, to),
    ),
    // Conversaciones ABIERTAS dentro de la ventana. Sin esto, "primera
    // respuesta" no era la primera de la conversación sino la primera que
    // caía en el rango: un hilo de hace meses que escribe hoy aportaba una
    // "primera respuesta" nueva cada período, mezclando turnos del medio
    // con la apertura real.
    fetchAllRows<{ id: string }>((from, to) =>
      db
        .from('conversations')
        .select('id')
        .gte('created_at', fetchStart)
        .lt('created_at', fetchEnd)
        .range(from, to),
    ),
  ])
  const openedInWindow = new Set(openedRows.map((c) => c.id))

  // Pair each unreplied customer message with the next outbound from the
  // agent/bot. A customer message counts once (avoids inflating averages if
  // the customer double-messages while we take time to reply).
  //
  // `isFirst` marca el primer intercambio de cada conversación. Con eso, la
  // misma pasada alimenta las dos lecturas: cuánto tardamos en aparecer
  // (`first`) y a qué ritmo sostenemos la conversación (`all`).
  interface Sample {
    customerAt: Date
    responseAt: Date
    isFirst: boolean
  }
  const samples: Sample[] = []
  let currentConv = ''
  let pendingCustomer: Date | null = null
  let lastCustomer: Date | null = null
  let repliedInConv = false
  for (const row of rows) {
    if (row.conversation_id !== currentConv) {
      currentConv = row.conversation_id
      pendingCustomer = null
      lastCustomer = null
      repliedInConv = false
    }
    const ts = new Date(row.created_at)
    if (row.sender_type === 'customer') {
      // El reloj arranca en el primer mensaje de la ráfaga, PERO se reinicia
      // si el cliente volvió después de un silencio largo: esa respuesta
      // contesta al mensaje nuevo, no al viejo que quedó sin contestar. Sin
      // el corte, el tiempo muerto entre visitas se sumaba al promedio (un
      // mensaje sin responder de hace dos semanas convertía una respuesta de
      // 2 minutos en una de 14 días) y encima la respuesta rápida real se
      // perdía.
      if (
        !pendingCustomer ||
        (lastCustomer && ts.getTime() - lastCustomer.getTime() > SESSION_GAP_MS)
      ) {
        pendingCustomer = ts
      }
      lastCustomer = ts
    } else if (pendingCustomer) {
      // Una plantilla/broadcast NO es una respuesta a la pregunta del cliente
      // (es un envío masivo de marketing al mismo hilo): no debe contar como
      // respuesta ni fabricar un tiempo. Lo mismo con lo que sale por
      // iniciativa nuestra (seguimientos, avisos de pedido, captación).
      const proactive =
        row.content_type === 'template' || PROACTIVE_ORIGINS.has(row.origin ?? '')
      if (proactive) continue
      // Fuera de la ventana de atención nada de lo que mandamos contesta al
      // mensaje viejo: es un contacto nuevo. Es el caso de la conversación
      // que terminó con un "gracias" del cliente —atendida, sin nada que
      // responder— y que semanas después recibe un mensaje nuestro. Contarlo
      // convertía ese cierre en una espera de semanas. En WhatsApp, además,
      // pasadas las 24 h ya no se puede contestar sin plantilla, así que un
      // saliente tardío no es una respuesta ni siquiera técnicamente.
      if (ts.getTime() - pendingCustomer.getTime() > SESSION_GAP_MS) {
        pendingCustomer = null
        lastCustomer = null
        continue
      }
      samples.push({
        customerAt: pendingCustomer,
        responseAt: ts,
        isFirst: !repliedInConv && openedInWindow.has(row.conversation_id),
      })
      repliedInConv = true
      pendingCustomer = null
      lastCustomer = null
    }
  }

  // Buckets que siguen el RANGO elegido (hora para Hoy/Ayer, día para 7d/30d/
  // custom) — mismos que la gráfica de conversaciones, para que el chart sea
  // preciso con las fechas seleccionadas y no un Lun–Dom fijo.
  const gran = bucketGranularity(range)
  const keys = rangeBucketKeys(tz, range, gran)

  const summarize = (list: Sample[]): ResponseTimeSummary =>
    summarizeSamples(list, keys, tz, gran, range, prev)

  return {
    first: summarize(samples.filter((s) => s.isFirst)),
    all: summarize(samples),
  }
}

/**
 * Agrupa las muestras en los buckets del rango y saca los promedios del
 * período actual y del anterior. Se extrajo para que las dos lecturas
 * (primera respuesta / todas) se calculen exactamente igual y no puedan
 * divergir con el tiempo.
 */
function summarizeSamples(
  samples: { customerAt: Date; responseAt: Date }[],
  keys: string[],
  tz: string,
  gran: Parameters<typeof bucketKeyOf>[2],
  range: DateRange,
  prev: DateRange,
): ResponseTimeSummary {
  const inRange = (d: Date, r: DateRange) => d >= r.start && d < r.end
  const byKey = new Map<string, number[]>()
  for (const k of keys) byKey.set(k, [])
  const curMins: number[] = []
  const prevMins: number[] = []

  for (const sple of samples) {
    const diffMin = (sple.responseAt.getTime() - sple.customerAt.getTime()) / 60_000
    if (diffMin < 0) continue
    if (inRange(sple.customerAt, range)) {
      const k = bucketKeyOf(tz, sple.customerAt.toISOString(), gran)
      byKey.get(k)?.push(diffMin)
      curMins.push(diffMin)
    } else if (inRange(sple.customerAt, prev)) {
      prevMins.push(diffMin)
    }
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length

  const buckets: ResponseTimeBucket[] = keys.map((key) => {
    const list = byKey.get(key) ?? []
    return { key, avgMinutes: avg(list), samples: list.length }
  })

  return {
    buckets,
    thisPeriodAvg: avg(curMins),
    prevPeriodAvg: avg(prevMins),
  }
}

// --- 4. Activity feed --------------------------------------------------

export async function loadActivity(
  db: DB,
  t: TFn,
  limit = 20,
): Promise<ActivityItem[]> {
  // Actividad reciente GLOBAL de todo Riverz — NO se filtra por el rango de
  // fechas del panel. Siempre son los eventos más recientes (mensajes,
  // comentarios, llamadas, contactos, campañas, automatizaciones), ordenados por
  // fecha desc. Cada fuente trae sus N más recientes y luego se mezclan.
  const contactCols = 'name, phone, email, channel, external_id'
  const [msgs, calls, contacts, broadcasts, autoLogs] = await Promise.all([
    // `conversations!inner` + deleted_at filter: no mostrar mensajes de chats
    // borrados de la bandeja. content_type + channel distinguen comentario de DM.
    db
      .from('messages')
      .select(`id, content_type, sender_type, created_at, conversation_id, conversations!inner(deleted_at, channel, contact_id, contacts(${contactCols}))`)
      .eq('sender_type', 'customer')
      .is('conversations.deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit),
    db
      .from('voice_calls')
      .select(`id, direction, status, outcome, phone, created_at, contact:contacts(${contactCols})`)
      .order('created_at', { ascending: false })
      .limit(limit),
    db
      .from('contacts')
      .select(`id, ${contactCols}, created_at`)
      .order('created_at', { ascending: false })
      .limit(limit),
    db
      .from('broadcasts')
      .select('id, name, status, total_recipients, created_at')
      .order('created_at', { ascending: false })
      .limit(limit),
    db
      .from('automation_logs')
      .select(`id, trigger_event, status, created_at, automation:automations(name), contact:contacts(${contactCols})`)
      .order('created_at', { ascending: false })
      .limit(limit),
  ])

  const items: ActivityItem[] = []

  type ContactRow = {
    name: string | null
    phone: string | null
    email: string | null
    channel: string | null
    external_id: string | null
  }

  // PostgREST returns nested selections as arrays by default, even when
  // the foreign key is 1:1. We normalise by taking [0] on each level.
  for (const m of (msgs.data ?? []) as unknown as Array<{
    id: string
    content_type: string | null
    created_at: string
    conversation_id: string
    conversations:
      | { channel?: string | null; contacts: ContactRow[] | ContactRow | null }[]
      | { channel?: string | null; contacts: ContactRow[] | ContactRow | null }
      | null
  }>) {
    const conv = Array.isArray(m.conversations) ? m.conversations[0] : m.conversations
    const contact = Array.isArray(conv?.contacts) ? conv?.contacts[0] : conv?.contacts
    const who = contact
      ? contactLabel(t, contact)
      : t('dashboard.activityUnknownContact')
    const isComment = m.content_type === 'comment' || (conv?.channel ?? '').includes('comment')
    items.push({
      id: `msg-${m.id}`,
      kind: isComment ? 'comment' : 'message',
      text: isComment
        ? t('dashboard.activityNewComment', { who })
        : t('dashboard.activityNewMessage', { who }),
      at: m.created_at,
      href: `/bandeja?c=${m.conversation_id}`,
    })
  }

  // Llamadas de voz (entrantes + salientes).
  for (const c of (calls.data ?? []) as unknown as Array<{
    id: string
    direction: string | null
    status: string | null
    phone: string | null
    created_at: string
    contact: ContactRow[] | ContactRow | null
  }>) {
    const contact = Array.isArray(c.contact) ? c.contact[0] : c.contact
    const who = contact ? contactLabel(t, contact) : c.phone || t('dashboard.activitySomeContact')
    items.push({
      id: `call-${c.id}`,
      kind: 'call',
      text:
        c.direction === 'inbound'
          ? t('dashboard.activityCallInbound', { who })
          : t('dashboard.activityCallOutbound', { who }),
      at: c.created_at,
      href: '/voz',
    })
  }

  for (const c of (contacts.data ?? []) as Array<ContactRow & { id: string; created_at: string }>) {
    items.push({
      id: `contact-${c.id}`,
      kind: 'contact',
      text: t('dashboard.activityNewContact', { who: contactLabel(t, c) }),
      at: c.created_at,
      href: '/contactos',
    })
  }

  const statusWord = (status: string): string => {
    switch (status) {
      case 'draft':
        return t('dashboard.broadcastStatusDraft')
      case 'scheduled':
        return t('dashboard.broadcastStatusScheduled')
      case 'sending':
        return t('dashboard.broadcastStatusSending')
      case 'sent':
        return t('dashboard.broadcastStatusSent')
      case 'failed':
        return t('dashboard.broadcastStatusFailed')
      default:
        return status
    }
  }

  for (const b of (broadcasts.data ?? []) as Array<{
    id: string
    name: string
    status: string
    total_recipients: number
    created_at: string
  }>) {
    const text =
      b.status === 'sent'
        ? t('dashboard.activityBroadcastSent', { name: b.name, n: b.total_recipients })
        : t('dashboard.activityBroadcastStatus', {
            name: b.name,
            status: statusWord(b.status),
            n: b.total_recipients,
          })
    items.push({
      id: `broadcast-${b.id}`,
      kind: 'broadcast',
      text,
      at: b.created_at,
      href: '/campanas',
    })
  }

  for (const l of (autoLogs.data ?? []) as unknown as Array<{
    id: string
    status: string
    created_at: string
    automation: { name: string }[] | { name: string } | null
    contact: ContactRow[] | ContactRow | null
  }>) {
    const automation = Array.isArray(l.automation) ? l.automation[0] : l.automation
    const contact = Array.isArray(l.contact) ? l.contact[0] : l.contact
    const who = contact ? contactLabel(t, contact) : t('dashboard.activitySomeContact')
    const autoName = automation?.name || t('dashboard.activityAutomationName')
    items.push({
      id: `auto-${l.id}`,
      kind: 'automation',
      text:
        l.status === 'failed'
          ? t('dashboard.activityAutomationFailed', { name: autoName, who })
          : t('dashboard.activityAutomationRan', { name: autoName, who }),
      at: l.created_at,
    })
  }

  return items
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit)
}
