import type { SupabaseClient } from '@supabase/supabase-js'
import {
  bucketGranularity,
  bucketKeyOf,
  mondayIndex,
  rangeBucketKeys,
  type DateRange,
} from './date-utils'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  ResponseTimeBucket,
  ResponseTimeSummary,
} from './types'

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

// --- 1. Metric cards ---------------------------------------------------

export async function loadMetrics(
  db: DB,
  tz: string,
  range: DateRange,
  prev: DateRange,
): Promise<MetricsBundle> {
  const s = iso(range.start)
  const e = iso(range.end)
  const ps = iso(prev.start)
  const pe = iso(prev.end)

  const [
    openConvCur,
    newContactsCur,
    newContactsPrev,
    resolvedCur,
    resolvedPrev,
    messagesSentCur,
    messagesSentPrev,
    messagesRecvCur,
    messagesRecvPrev,
  ] = await Promise.all([
    // Active conversations = open RIGHT NOW (a live snapshot, not range-bound).
    db.from('conversations').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    db.from('contacts').select('id', { count: 'exact', head: true }).gte('created_at', s).lt('created_at', e),
    db.from('contacts').select('id', { count: 'exact', head: true }).gte('created_at', ps).lt('created_at', pe),
    // "Resueltas" — gate on closed_at (set by code only when status actually
    // flips to closed), not updated_at which the BEFORE UPDATE trigger bumps
    // on every unrelated edit.
    db.from('conversations').select('id', { count: 'exact', head: true }).eq('status', 'closed').gte('closed_at', s).lt('closed_at', e),
    db.from('conversations').select('id', { count: 'exact', head: true }).eq('status', 'closed').gte('closed_at', ps).lt('closed_at', pe),
    // "Mensajes enviados" — anything we sent: agent (human) + bot (AI /
    // automations / flows / broadcasts). Matches the series' outgoing branch.
    db.from('messages').select('id', { count: 'exact', head: true }).neq('sender_type', 'customer').gte('created_at', s).lt('created_at', e),
    db.from('messages').select('id', { count: 'exact', head: true }).neq('sender_type', 'customer').gte('created_at', ps).lt('created_at', pe),
    db.from('messages').select('id', { count: 'exact', head: true }).eq('sender_type', 'customer').gte('created_at', s).lt('created_at', e),
    db.from('messages').select('id', { count: 'exact', head: true }).eq('sender_type', 'customer').gte('created_at', ps).lt('created_at', pe),
  ])

  // Channel mix — over the selected range. Paginated so it counts EVERY
  // message, not just the first 1000 (otherwise the mix disagrees with the
  // sent/received KPI totals on wide ranges).
  type MixRow = { channel?: string | null; sender_type?: string | null }
  const channelMixRows = await fetchAllRows<MixRow>((from, to) =>
    db
      .from('messages')
      .select('channel, sender_type')
      .gte('created_at', s)
      .lt('created_at', e)
      .range(from, to),
  )

  const mix = new Map<string, { inbound: number; outbound: number }>()
  for (const r of channelMixRows) {
    const ch = r.channel ?? 'unknown'
    const m = mix.get(ch) ?? { inbound: 0, outbound: 0 }
    if (r.sender_type === 'customer') m.inbound++
    else m.outbound++
    mix.set(ch, m)
  }
  const channelMix = [...mix.entries()]
    .map(([channel, v]) => ({ channel, inbound: v.inbound, outbound: v.outbound }))
    .sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound))

  return {
    // Instantaneous count — "previous" equals current so the delta widget
    // renders neutral (it's "en curso ahora", not a windowed metric).
    activeConversations: {
      current: openConvCur.count ?? 0,
      previous: openConvCur.count ?? 0,
    },
    newContacts: { current: newContactsCur.count ?? 0, previous: newContactsPrev.count ?? 0 },
    resolved: { current: resolvedCur.count ?? 0, previous: resolvedPrev.count ?? 0 },
    messagesSent: { current: messagesSentCur.count ?? 0, previous: messagesSentPrev.count ?? 0 },
    messagesReceived: { current: messagesRecvCur.count ?? 0, previous: messagesRecvPrev.count ?? 0 },
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

export async function loadResponseTime(
  db: DB,
  tz: string,
  range: DateRange,
  prev: DateRange,
): Promise<ResponseTimeSummary> {
  // Fetch the union of the current + previous windows in one shot, then
  // classify each "first inbound → first subsequent outbound" pair into the
  // period its customer message falls in. Day-of-week buckets reflect the
  // CURRENT range only; prev feeds the comparison average.
  const fetchStart = iso(new Date(Math.min(range.start.getTime(), prev.start.getTime())))
  const fetchEnd = iso(new Date(Math.max(range.end.getTime(), prev.end.getTime())))
  // Paginated: ordered by (conversation_id, created_at) so the customer→reply
  // pairing below sees complete conversations even past the 1000-row cap.
  const rows = await fetchAllRows<{
    conversation_id: string
    sender_type: string
    created_at: string
  }>((from, to) =>
    db
      .from('messages')
      .select('conversation_id, sender_type, created_at')
      .gte('created_at', fetchStart)
      .lt('created_at', fetchEnd)
      .order('conversation_id', { ascending: true })
      .order('created_at', { ascending: true })
      .range(from, to),
  )

  // Pair each unreplied customer message with the next outbound from the
  // agent/bot. A customer message counts once (avoids inflating averages if
  // the customer double-messages while we take time to reply).
  interface Sample {
    customerAt: Date
    responseAt: Date
  }
  const samples: Sample[] = []
  let currentConv = ''
  let pendingCustomer: Date | null = null
  for (const row of rows) {
    if (row.conversation_id !== currentConv) {
      currentConv = row.conversation_id
      pendingCustomer = null
    }
    const ts = new Date(row.created_at)
    if (row.sender_type === 'customer') {
      if (!pendingCustomer) pendingCustomer = ts
    } else if (pendingCustomer) {
      samples.push({ customerAt: pendingCustomer, responseAt: ts })
      pendingCustomer = null
    }
  }

  const inRange = (d: Date, r: DateRange) => d >= r.start && d < r.end

  const byDow = new Map<number, number[]>()
  for (let i = 0; i < 7; i++) byDow.set(i, [])
  const curMins: number[] = []
  const prevMins: number[] = []

  for (const sple of samples) {
    const diffMin = (sple.responseAt.getTime() - sple.customerAt.getTime()) / 60_000
    if (diffMin < 0) continue
    if (inRange(sple.customerAt, range)) {
      byDow.get(mondayIndex(tz, sple.customerAt))!.push(diffMin)
      curMins.push(diffMin)
    } else if (inRange(sple.customerAt, prev)) {
      prevMins.push(diffMin)
    }
  }

  const avg = (arr: number[]) => (arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length)

  const buckets: ResponseTimeBucket[] = Array.from({ length: 7 }, (_, dow) => {
    const list = byDow.get(dow) ?? []
    return { dow, avgMinutes: avg(list), samples: list.length }
  })

  return {
    buckets,
    thisPeriodAvg: avg(curMins),
    prevPeriodAvg: avg(prevMins),
  }
}

// --- 4. Activity feed --------------------------------------------------

export async function loadActivity(db: DB, range: DateRange, limit = 20): Promise<ActivityItem[]> {
  const s = iso(range.start)
  const e = iso(range.end)
  const [msgs, contacts, broadcasts, autoLogs] = await Promise.all([
    db
      .from('messages')
      .select('id, content_text, sender_type, created_at, conversation_id, conversations(contact_id, contacts(name, phone))')
      .eq('sender_type', 'customer')
      .gte('created_at', s)
      .lt('created_at', e)
      .order('created_at', { ascending: false })
      .limit(limit),
    db
      .from('contacts')
      .select('id, name, phone, created_at')
      .gte('created_at', s)
      .lt('created_at', e)
      .order('created_at', { ascending: false })
      .limit(limit),
    db
      .from('broadcasts')
      .select('id, name, status, total_recipients, created_at')
      .gte('created_at', s)
      .lt('created_at', e)
      .order('created_at', { ascending: false })
      .limit(limit),
    db
      .from('automation_logs')
      .select('id, trigger_event, status, created_at, automation:automations(name), contact:contacts(name, phone)')
      .gte('created_at', s)
      .lt('created_at', e)
      .order('created_at', { ascending: false })
      .limit(limit),
  ])

  const items: ActivityItem[] = []

  // PostgREST returns nested selections as arrays by default, even when
  // the foreign key is 1:1. We normalise by taking [0] on each level.
  for (const m of (msgs.data ?? []) as unknown as Array<{
    id: string
    content_text: string | null
    created_at: string
    conversation_id: string
    conversations:
      | { contact_id: string | null; contacts: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null }[]
      | { contact_id: string | null; contacts: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null }
      | null
  }>) {
    const conv = Array.isArray(m.conversations) ? m.conversations[0] : m.conversations
    const contact = Array.isArray(conv?.contacts) ? conv?.contacts[0] : conv?.contacts
    const who = contact?.name || contact?.phone || 'Desconocido'
    items.push({
      id: `msg-${m.id}`,
      kind: 'message',
      text: `Nuevo mensaje de ${who}`,
      at: m.created_at,
      href: `/bandeja?c=${m.conversation_id}`,
    })
  }

  for (const c of (contacts.data ?? []) as Array<{ id: string; name: string | null; phone: string; created_at: string }>) {
    items.push({
      id: `contact-${c.id}`,
      kind: 'contact',
      text: `Nuevo contacto: ${c.name || c.phone}`,
      at: c.created_at,
      href: '/contactos',
    })
  }

  for (const b of (broadcasts.data ?? []) as Array<{
    id: string
    name: string
    status: string
    total_recipients: number
    created_at: string
  }>) {
    const STATUS_ES: Record<string, string> = {
      draft: 'borrador',
      scheduled: 'programada',
      sending: 'enviando',
      sent: 'enviada',
      failed: 'fallida',
    }
    const label =
      b.status === 'sent'
        ? `enviada a ${b.total_recipients} contactos`
        : `${STATUS_ES[b.status] ?? b.status} (${b.total_recipients} destinatarios)`
    items.push({
      id: `broadcast-${b.id}`,
      kind: 'broadcast',
      text: `Campaña "${b.name}" ${label}`,
      at: b.created_at,
      href: '/campanas',
    })
  }

  for (const l of (autoLogs.data ?? []) as unknown as Array<{
    id: string
    trigger_event: string
    status: string
    created_at: string
    automation: { name: string }[] | { name: string } | null
    contact: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null
  }>) {
    const automation = Array.isArray(l.automation) ? l.automation[0] : l.automation
    const contact = Array.isArray(l.contact) ? l.contact[0] : l.contact
    const who = contact?.name || contact?.phone || 'un contacto'
    const autoName = automation?.name || 'Automatización'
    items.push({
      id: `auto-${l.id}`,
      kind: 'automation',
      text: `Automatización "${autoName}" ${l.status === 'failed' ? 'falló para' : 'se ejecutó para'} ${who}`,
      at: l.created_at,
    })
  }

  return items
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit)
}
