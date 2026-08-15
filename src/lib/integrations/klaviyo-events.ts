/**
 * Lo que pasa en Riverz, contado como eventos de Klaviyo.
 *
 * Espejar contactos deja una lista; lo que convierte a Klaviyo en algo útil
 * son los EVENTOS: son el disparador de sus flujos y, sobre todo, lo que su
 * reporte usa para atribuir plata. Con esto el comercio puede ver, en su
 * propia herramienta de email, cuánto vendió la conversación de WhatsApp — y
 * armar flujos que reaccionen a ella ("le escribió y no compró en 3 días").
 *
 * Se leen las tablas que ya existen en vez de instrumentar cada camino de
 * envío: una corrida por marca de agua no puede perderse eventos por un
 * `await` que alguien olvidó, y no agrega latencia a los caminos calientes.
 *
 * Cada evento viaja con `unique_id`, así que repetir la ventana no duplica
 * nada del lado de Klaviyo — y la ventana SE REPITE a propósito (una hora de
 * solape), porque una fila puede escribirse con retraso.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { chunk, fetchAllRows } from '@/lib/supabase/paginate';
import { klaviyoFetch, KlaviyoUnauthorizedError, profileIdentity } from './klaviyo';

/** Nombres tal como los ve el comercio en Klaviyo. Con marca, para que no se
 *  confundan con los que le manda su propia tienda. */
export const METRICS = {
  order: 'Riverz · Compró',
  cart: 'Riverz · Carrito abandonado',
  inbound: 'Riverz · Escribió por mensajería',
  rejected: 'Riverz · Pago rechazado',
} as const;

/** Tope por tipo y por corrida: una cuenta ruidosa no debe comerse el tick. */
const MAX_PER_KIND = 2000;
/** Klaviyo admite hasta 1.000 eventos por pedido; 500 deja margen. */
const EVENT_CHUNK = 500;

interface PendingEvent {
  /** Identificadores del perfil (al menos uno). */
  email: string | null;
  phone: string | null;
  metric: string;
  time: string;
  uniqueId: string;
  value?: number | null;
  currency?: string | null;
  properties: Record<string, unknown>;
}

/** Envía en lote. Devuelve cuántos entraron. */
async function sendEvents(apiKey: string, events: PendingEvent[]): Promise<number> {
  let sent = 0;
  for (const slice of chunk(events, EVENT_CHUNK)) {
    const body = {
      data: {
        type: 'event-bulk-create-job',
        attributes: {
          'events-bulk-create': {
            data: slice.map((e) => ({
              type: 'event-bulk-create',
              attributes: {
                profile: {
                  data: {
                    type: 'profile',
                    attributes: {
                      ...(e.email ? { email: e.email } : {}),
                      ...(e.phone ? { phone_number: e.phone } : {}),
                    },
                  },
                },
                events: {
                  data: [
                    {
                      type: 'event',
                      attributes: {
                        metric: {
                          data: { type: 'metric', attributes: { name: e.metric } },
                        },
                        properties: e.properties,
                        time: e.time,
                        unique_id: e.uniqueId,
                        ...(e.value != null && Number.isFinite(e.value)
                          ? { value: e.value }
                          : {}),
                        ...(e.currency ? { value_currency: e.currency } : {}),
                      },
                    },
                  ],
                },
              },
            })),
          },
        },
      },
    };
    const res = await klaviyoFetch(apiKey, '/event-bulk-create-jobs/', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (res.ok) sent += slice.length;
    else if (res.status === 401 || res.status === 403) throw new KlaviyoUnauthorizedError();
  }
  return sent;
}

/** Mensaje entrante con su conversación embebida. PostgREST devuelve el embed
 *  como arreglo o como objeto según la relación, así que se aceptan los dos. */
interface InboundRow {
  id: string;
  channel: string | null;
  created_at: string;
  conversations:
    | { contact_id: string | null }
    | Array<{ contact_id: string | null }>
    | null;
}

function contactOf(row: InboundRow): string | null {
  const conv = Array.isArray(row.conversations) ? row.conversations[0] : row.conversations;
  return conv?.contact_id ?? null;
}

export interface EventSyncResult {
  orders: number;
  carts: number;
  inbound: number;
  rejected: number;
  sent: number;
}

/**
 * Identidad (correo/teléfono) de un conjunto de contactos, en un solo barrido.
 * Sin identidad no hay perfil que actualizar, así que el evento se descarta.
 */
async function identitiesOf(
  db: SupabaseClient,
  workspaceId: string,
  contactIds: string[],
): Promise<Map<string, { email: string | null; phone: string | null }>> {
  const out = new Map<string, { email: string | null; phone: string | null }>();
  const ids = [...new Set(contactIds.filter(Boolean))];
  for (const slice of chunk(ids, 300)) {
    const rows = await fetchAllRows<{ id: string; email: string | null; phone: string | null }>(
      (a, b) =>
        db
          .from('contacts')
          .select('id, email, phone')
          .eq('workspace_id', workspaceId)
          .in('id', slice)
          .order('id', { ascending: true })
          .range(a, b),
    );
    for (const r of rows) {
      const identity = profileIdentity(r.email, r.phone);
      if (identity) out.set(r.id, identity);
    }
  }
  return out;
}

export async function syncWorkspaceEvents(
  db: SupabaseClient,
  args: { workspaceId: string; apiKey: string; since: string | null },
): Promise<EventSyncResult> {
  // Primera corrida: sólo lo del último día. Reconstruir el historial entero
  // llenaría el reporte del comercio de eventos viejos fechados hoy.
  const from = args.since
    ? new Date(new Date(args.since).getTime() - 60 * 60 * 1000).toISOString()
    : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const pending: PendingEvent[] = [];
  const result: EventSyncResult = { orders: 0, carts: 0, inbound: 0, rejected: 0, sent: 0 };

  // ── Compras ────────────────────────────────────────────────────────
  // El evento con más valor: es el que le pone plata a la atribución.
  const orders = await fetchAllRows<{
    id: string;
    contact_id: string | null;
    customer_email: string | null;
    customer_phone: string | null;
    total_price: number | string | null;
    currency: string | null;
    order_number: string | null;
    channel: string | null;
    platform: string | null;
    created_at: string;
  }>(
    (a, b) =>
      db
        .from('orders')
        .select(
          'id, contact_id, customer_email, customer_phone, total_price, currency, order_number, channel, platform, created_at',
        )
        .eq('workspace_id', args.workspaceId)
        .gte('created_at', from)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(a, b),
    { max: MAX_PER_KIND },
  );
  for (const o of orders) {
    const identity =
      profileIdentity(o.customer_email, o.customer_phone) ?? null;
    if (!identity) continue;
    result.orders++;
    pending.push({
      ...identity,
      metric: METRICS.order,
      time: o.created_at,
      uniqueId: `riverz-order-${o.id}`,
      value: o.total_price != null ? Number(o.total_price) : null,
      currency: o.currency,
      properties: {
        order_number: o.order_number,
        channel: o.channel,
        platform: o.platform,
      },
    });
  }

  // ── Carritos abandonados ───────────────────────────────────────────
  const carts = await fetchAllRows<{
    id: string;
    customer_email: string | null;
    customer_phone: string | null;
    total_price: number | string | null;
    currency: string | null;
    abandoned_checkout_url: string | null;
    created_at: string;
    completed_at: string | null;
  }>(
    (a, b) =>
      db
        .from('shopify_checkouts')
        .select(
          'id, customer_email, customer_phone, total_price, currency, abandoned_checkout_url, created_at, completed_at',
        )
        .eq('workspace_id', args.workspaceId)
        .is('completed_at', null)
        .gte('created_at', from)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(a, b),
    { max: MAX_PER_KIND },
  );
  for (const c of carts) {
    const identity = profileIdentity(c.customer_email, c.customer_phone);
    if (!identity) continue;
    result.carts++;
    pending.push({
      ...identity,
      metric: METRICS.cart,
      time: c.created_at,
      uniqueId: `riverz-cart-${c.id}`,
      value: c.total_price != null ? Number(c.total_price) : null,
      currency: c.currency,
      properties: { checkout_url: c.abandoned_checkout_url },
    });
  }

  // ── Pagos rechazados ───────────────────────────────────────────────
  const rejected = await fetchAllRows<{
    id: string;
    email: string | null;
    phone: string | null;
    amount: number | string | null;
    currency: string | null;
    reason_bucket: string | null;
    rejected_at: string;
  }>(
    (a, b) =>
      db
        .from('mp_rejected_payments')
        .select('id, email, phone, amount, currency, reason_bucket, rejected_at')
        .eq('workspace_id', args.workspaceId)
        .gte('rejected_at', from)
        .order('rejected_at', { ascending: true })
        .order('id', { ascending: true })
        .range(a, b),
    { max: MAX_PER_KIND },
  );
  for (const p of rejected) {
    const identity = profileIdentity(p.email, p.phone);
    if (!identity) continue;
    result.rejected++;
    pending.push({
      ...identity,
      metric: METRICS.rejected,
      time: p.rejected_at,
      uniqueId: `riverz-rejected-${p.id}`,
      value: p.amount != null ? Number(p.amount) : null,
      currency: p.currency,
      properties: { reason: p.reason_bucket },
    });
  }

  // ── Escribió por mensajería ────────────────────────────────────────
  // Un evento por conversación y por ventana, no por mensaje: quien manda
  // ocho mensajes seguidos no debe aparecer ocho veces en el flujo del
  // comercio. El identificador único lleva la hora truncada a la hora.
  //
  // `messages` no tiene workspace_id: el dueño del mensaje es su conversación.
  // Se filtra por el join, que además trae el contacto de una.
  const inbound = await fetchAllRows<InboundRow>(
    (a, b) =>
      db
        .from('messages')
        .select('id, channel, created_at, conversations!inner(workspace_id, contact_id)')
        .eq('conversations.workspace_id', args.workspaceId)
        .eq('sender_type', 'customer')
        .gte('created_at', from)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(a, b) as unknown as PromiseLike<{
        data: InboundRow[] | null;
        error: { message?: string } | null;
      }>,
    { max: MAX_PER_KIND },
  );
  if (inbound.length) {
    const contactIds = inbound
      .map(contactOf)
      .filter((x): x is string => Boolean(x));
    const ids = await identitiesOf(db, args.workspaceId, contactIds);
    const seen = new Set<string>();
    for (const m of inbound) {
      const contactId = contactOf(m);
      if (!contactId) continue;
      const identity = ids.get(contactId);
      if (!identity) continue;
      const hour = m.created_at.slice(0, 13);
      const uniqueId = `riverz-inbound-${contactId}-${hour}`;
      if (seen.has(uniqueId)) continue;
      seen.add(uniqueId);
      result.inbound++;
      pending.push({
        ...identity,
        metric: METRICS.inbound,
        time: m.created_at,
        uniqueId,
        properties: { channel: m.channel },
      });
    }
  }

  if (pending.length) result.sent = await sendEvents(args.apiKey, pending);
  return result;
}
