import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Unified per-contact activity timeline. Aggregates every per-contact,
 * timestamped event across the schema (orders, abandoned carts, messages,
 * broadcasts, automations, tags, notes, flows) into one chronological list.
 *
 * Robustness: every source uses `select('*')` (so a column-name drift can't
 * error) and is wrapped so one failing source never blanks the whole
 * timeline. Names for tags/broadcasts/automations are looked up in a second
 * batched query rather than via PostgREST joins (which would fail closed on a
 * relationship-name mismatch).
 *
 * Runs client-side with the browser Supabase client — RLS scopes it to the
 * caller's workspace, same pattern as the segment resolver.
 */

export type ContactActivityKind =
  | 'order'
  | 'cart'
  | 'message_in'
  | 'message_out'
  | 'broadcast'
  | 'automation'
  | 'tag'
  | 'note'
  | 'flow'

export interface ContactActivityEvent {
  id: string
  /** ISO timestamp; events are returned newest-first. */
  at: string
  kind: ContactActivityKind
  /** Data text (order #, message preview, tag/campaign name) — NOT translated. */
  detail: string
  /** Optional status chip (order status, broadcast/automation outcome). */
  status?: string | null
}

type Row = Record<string, unknown>

const str = (v: unknown): string => (v == null ? '' : String(v))

/** First non-empty value among the given keys. */
function pick(row: Row, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k]
    if (v != null && v !== '') return String(v)
  }
  return ''
}

export async function loadContactActivity(
  db: SupabaseClient,
  contact: { id: string; phone?: string | null; workspace_id?: string | null },
): Promise<ContactActivityEvent[]> {
  const id = contact.id
  const ws = contact.workspace_id ?? undefined
  const phone = contact.phone ?? undefined

  const safe = (p: Promise<ContactActivityEvent[]>) => p.catch(() => [])

  const sources: Promise<ContactActivityEvent[]>[] = [
    // ── Orders (AI / Shopify) ──────────────────────────────────
    safe(
      (async () => {
        const { data } = await db
          .from('orders')
          .select('*')
          .eq('contact_id', id)
          .order('created_at', { ascending: false })
          .limit(50)
        return (data ?? []).map((r: Row) => {
          const num = pick(r, 'order_number', 'name', 'order_name', 'shopify_order_id')
          const total = pick(r, 'total_price', 'total')
          const cur = pick(r, 'currency')
          const detail =
            [num && `#${num}`, total && `${total} ${cur}`.trim()]
              .filter(Boolean)
              .join(' · ') || ''
          return {
            id: `order-${str(r.id)}`,
            at: pick(r, 'created_at'),
            kind: 'order' as const,
            detail,
            status: pick(r, 'status', 'financial_status') || null,
          }
        })
      })(),
    ),

    // ── Compras en la tienda (migración 172) ───────────────────
    // `orders` son los pedidos que originó el asistente; éstos son los que
    // hizo el cliente por su cuenta. Sin ellos la línea de tiempo mostraba
    // conversaciones y campañas pero no la compra que las siguió.
    safe(
      (async () => {
        const { data } = await db
          .from('contact_purchases')
          .select('*')
          .eq('contact_id', id)
          .order('placed_at', { ascending: false })
          .limit(50)
        return (data ?? []).map((r: Row) => {
          // Sin el "#" de Shopify: es la misma clave con la que se compara
          // contra el espejo del asistente para no mostrar el pedido dos veces.
          const num = pick(r, 'order_number', 'external_id').replace(/^#/, '')
          const total = pick(r, 'total')
          const cur = pick(r, 'currency')
          return {
            id: `purchase-${str(r.id)}`,
            at: pick(r, 'placed_at', 'created_at'),
            kind: 'order' as const,
            detail:
              [num && `#${num}`, total && `${total} ${cur}`.trim()]
                .filter(Boolean)
                .join(' · ') || '',
            status: pick(r, 'fulfillment_status', 'financial_status') || null,
          }
        })
      })(),
    ),

    // ── Abandoned carts (matched by phone) ─────────────────────
    safe(
      (async () => {
        if (!ws || !phone) return []
        const { data } = await db
          .from('shopify_checkouts')
          .select('*')
          .eq('workspace_id', ws)
          .eq('customer_phone', phone)
          .order('created_at', { ascending: false })
          .limit(30)
        return (data ?? [])
          .filter((r: Row) => !r.completed_at)
          .map((r: Row) => {
            const total = pick(r, 'total_price')
            const cur = pick(r, 'currency')
            return {
              id: `cart-${str(r.id)}`,
              at: pick(r, 'created_at'),
              kind: 'cart' as const,
              detail: total ? `${total} ${cur}`.trim() : '',
              status: null,
            }
          })
      })(),
    ),

    // ── Messages (via conversations) ───────────────────────────
    safe(
      (async () => {
        const { data: convs } = await db
          .from('conversations')
          .select('id')
          .eq('contact_id', id)
        const convIds = (convs ?? []).map((c: Row) => str(c.id)).filter(Boolean)
        if (convIds.length === 0) return []
        const { data } = await db
          .from('messages')
          .select('*')
          .in('conversation_id', convIds)
          .order('created_at', { ascending: false })
          .limit(40)
        return (data ?? []).map((r: Row) => {
          const dir = pick(r, 'direction')
          const sender = pick(r, 'sender_type', 'sender', 'role')
          const inbound =
            dir === 'inbound' || sender === 'customer' || sender === 'contact'
          const body =
            pick(r, 'content', 'body', 'text', 'message', 'caption') || '—'
          return {
            id: `msg-${str(r.id)}`,
            at: pick(r, 'created_at'),
            kind: inbound ? ('message_in' as const) : ('message_out' as const),
            detail: body.slice(0, 140),
          }
        })
      })(),
    ),

    // ── Broadcasts received ────────────────────────────────────
    safe(
      (async () => {
        const { data } = await db
          .from('broadcast_recipients')
          .select('*')
          .eq('contact_id', id)
          .order('created_at', { ascending: false })
          .limit(30)
        const rows = (data ?? []) as Row[]
        const names = await lookupNames(db, 'broadcasts', rows.map((r) => str(r.broadcast_id)))
        return rows.map((r) => ({
          id: `bc-${str(r.id)}`,
          at: pick(r, 'sent_at', 'created_at'),
          kind: 'broadcast' as const,
          detail: names.get(str(r.broadcast_id)) ?? '',
          status: pick(r, 'status') || null,
        }))
      })(),
    ),

    // ── Automations fired ──────────────────────────────────────
    safe(
      (async () => {
        const { data } = await db
          .from('automation_logs')
          .select('*')
          .eq('contact_id', id)
          .order('created_at', { ascending: false })
          .limit(30)
        const rows = (data ?? []) as Row[]
        const names = await lookupNames(db, 'automations', rows.map((r) => str(r.automation_id)))
        return rows.map((r) => ({
          id: `auto-${str(r.id)}`,
          at: pick(r, 'created_at'),
          kind: 'automation' as const,
          detail: names.get(str(r.automation_id)) ?? pick(r, 'trigger_event') ?? '',
          status: pick(r, 'status') || null,
        }))
      })(),
    ),

    // ── Tags applied ───────────────────────────────────────────
    safe(
      (async () => {
        const { data } = await db
          .from('contact_tags')
          .select('*')
          .eq('contact_id', id)
          .order('created_at', { ascending: false })
          .limit(50)
        const rows = (data ?? []) as Row[]
        const names = await lookupNames(db, 'tags', rows.map((r) => str(r.tag_id)))
        return rows.map((r) => ({
          id: `tag-${str(r.id)}`,
          at: pick(r, 'created_at'),
          kind: 'tag' as const,
          detail: names.get(str(r.tag_id)) ?? '',
        }))
      })(),
    ),

    // ── Notes ──────────────────────────────────────────────────
    safe(
      (async () => {
        const { data } = await db
          .from('contact_notes')
          .select('*')
          .eq('contact_id', id)
          .order('created_at', { ascending: false })
          .limit(30)
        return (data ?? []).map((r: Row) => ({
          id: `note-${str(r.id)}`,
          at: pick(r, 'created_at'),
          kind: 'note' as const,
          detail: pick(r, 'note_text', 'text', 'note').slice(0, 160),
        }))
      })(),
    ),

    // ── Flow runs ──────────────────────────────────────────────
    safe(
      (async () => {
        const { data } = await db
          .from('flow_runs')
          .select('*')
          .eq('contact_id', id)
          .order('started_at', { ascending: false })
          .limit(20)
        return (data ?? []).map((r: Row) => ({
          id: `flow-${str(r.id)}`,
          at: pick(r, 'started_at', 'created_at'),
          kind: 'flow' as const,
          detail: pick(r, 'flow_name', 'name') || '',
          status: pick(r, 'status') || null,
        }))
      })(),
    ),
  ]

  const all = (await Promise.all(sources)).flat().filter((e) => e.at)
  all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  // Un pedido que el asistente originó está en las DOS tablas —`orders` y
  // `contact_purchases`— y aparecería dos veces. Se muestra una: gana el
  // primero, que por el orden de las fuentes es el espejo del asistente.
  const seenOrders = new Set<string>()
  const deduped = all.filter((e) => {
    if (e.kind !== 'order' || !e.detail) return true
    const key = e.detail.split(' · ')[0]
    if (seenOrders.has(key)) return false
    seenOrders.add(key)
    return true
  })
  return deduped.slice(0, 200)
}

/** Batch-fetch `id → name` for a table, tolerant of an absent `name` column. */
async function lookupNames(
  db: SupabaseClient,
  table: string,
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return out
  try {
    const { data } = await db.from(table).select('id, name').in('id', unique)
    for (const r of (data ?? []) as Row[]) out.set(str(r.id), str(r.name))
  } catch {
    /* table/name missing — names just stay blank */
  }
  return out
}
