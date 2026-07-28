import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import { supabaseAdmin } from "../admin-client";
import { getFreshMLToken } from "./adapter";
import { getLogger } from "@/lib/log/logger";

const ML = "https://api.mercadolibre.com";
const log = getLogger("channels.mercadolibre.orders");

/** Cuántos pedidos se traen por corrida. */
const PAGE = 50;
/** Primera sincronización: hasta dónde mirar hacia atrás. */
const FIRST_RUN_DAYS = 90;

export interface MlOrder {
  id: number;
  status?: string;
  status_detail?: string | null;
  date_created?: string;
  date_last_updated?: string;
  total_amount?: number;
  paid_amount?: number;
  currency_id?: string;
  buyer?: { id?: number; nickname?: string };
  order_items?: Array<{
    quantity?: number;
    unit_price?: number;
    item?: { id?: string; title?: string; variation_id?: number | null };
  }>;
  payments?: Array<{ status?: string }>;
  shipping?: { id?: number };
  pack_id?: number | null;
  tags?: string[];
}

interface MlShipment {
  status?: string;
  substatus?: string | null;
  tracking_number?: string | null;
  tracking_method?: string | null;
  receiver_address?: {
    city?: { name?: string };
    state?: { name?: string };
    zip_code?: string;
    address_line?: string;
    country?: { id?: string };
  };
}

/**
 * Espeja los pedidos de Mercado Libre dentro de Riverz.
 *
 * Por qué hace falta espejarlos y no consultarlos en vivo como Shopify: en
 * Mercado Libre el comprador llega **anonimizado** —la API devuelve sólo su id
 * y un apodo, sin nombre, sin email y con el teléfono enmascarado
 * (`XXXXXXX`)— así que no hay ningún dato con el que cruzarlo después. Lo
 * único que ata el pedido a la persona es el `buyer.id`, y ese mismo id es el
 * que ya identifica al contacto que escribió por el canal. Si no se guarda el
 * vínculo en el momento, se pierde.
 *
 * De ahí también que estos pedidos NO disparen automatizaciones: todo lo que
 * Riverz sabe hacer con un pedido pasa por escribirle al comprador, y a un
 * comprador de Mercado Libre sólo se le puede escribir por Mercado Libre.
 *
 * Incremental por `date_last_updated`: el cursor vive en
 * `channel_connections.config.orders_cursor`. La primera corrida mira 90 días
 * hacia atrás para que el comercio vea historia y no una pantalla vacía.
 */
export async function syncAllMercadoLibreOrders(): Promise<{
  sellers: number;
  orders: number;
  claims: number;
}> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("channel_connections")
    .select("*")
    .eq("channel", "mercadolibre")
    .in("status", ["connected", "error", "expired"]);
  const conns = (data ?? []) as ChannelConnection[];

  let orders = 0;
  let claims = 0;
  for (const conn of conns) {
    try {
      const r = await syncOneSeller(db, conn);
      orders += r.orders;
      claims += r.claims;
    } catch (err) {
      log.warn("ml orders sync failed", {
        connectionId: conn.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { sellers: conns.length, orders, claims };
}

async function syncOneSeller(
  db: SupabaseClient,
  conn: ChannelConnection,
): Promise<{ orders: number; claims: number }> {
  const cfg = (conn.config ?? {}) as Record<string, unknown>;
  const sellerId = String(cfg.seller_id ?? "");
  if (!sellerId) return { orders: 0, claims: 0 };

  const token = await getFreshMLToken(conn);
  const auth = { Authorization: `Bearer ${token}` };

  const cursor =
    typeof cfg.orders_cursor === "string" && cfg.orders_cursor
      ? cfg.orders_cursor
      : new Date(Date.now() - FIRST_RUN_DAYS * 86_400_000).toISOString();

  let offset = 0;
  let newest = cursor;
  let count = 0;

  for (;;) {
    const url =
      `${ML}/orders/search?seller=${sellerId}` +
      `&order.date_last_updated.from=${encodeURIComponent(mlDate(cursor))}` +
      `&sort=date_desc&limit=${PAGE}&offset=${offset}`;
    const res = await fetch(url, { headers: auth });
    if (!res.ok) {
      log.warn("ml orders search failed", {
        status: res.status,
        connectionId: conn.id,
      });
      break;
    }
    const page = (await res.json()) as { results?: MlOrder[]; paging?: { total?: number } };
    const results = page.results ?? [];
    if (results.length === 0) break;

    for (const o of results) {
      try {
        await upsertOrder(db, conn, o, auth);
        count++;
        const u = o.date_last_updated ?? o.date_created;
        if (u && u > newest) newest = u;
      } catch (err) {
        log.warn("ml order upsert failed", {
          orderId: o.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    offset += PAGE;
    // Tope defensivo: sin esto un cursor corrupto pagina la cuenta entera.
    if (offset >= Math.min(page.paging?.total ?? 0, 1000)) break;
  }

  const claims = await syncClaims(db, conn, auth);

  await db
    .from("channel_connections")
    .update({ config: { ...cfg, orders_cursor: newest } })
    .eq("id", conn.id);

  return { orders: count, claims };
}

async function upsertOrder(
  db: SupabaseClient,
  conn: ChannelConnection,
  o: MlOrder,
  auth: Record<string, string>,
): Promise<void> {
  const shipment = o.shipping?.id ? await fetchShipment(o.shipping.id, auth) : null;

  // El comprador ya existe como contacto si alguna vez escribió: el canal usa
  // su id de Mercado Libre como identificador externo. Se busca, no se crea —
  // un pedido sin conversación no justifica inventar un contacto vacío.
  let contactId: string | null = null;
  if (o.buyer?.id) {
    const { data } = await db
      .from("contacts")
      .select("id")
      .eq("workspace_id", conn.workspace_id)
      .eq("channel", "mercadolibre")
      .eq("external_id", String(o.buyer.id))
      .maybeSingle();
    contactId = (data as { id?: string } | null)?.id ?? null;
  }

  const addr = shipment?.receiver_address;
  const row = {
    workspace_id: conn.workspace_id,
    contact_id: contactId,
    channel: "mercadolibre",
    // `shop_domain` es la clave natural del espejo en el resto del producto;
    // Mercado Libre no tiene dominio, así que el vendedor hace de tienda.
    shop_domain: `mercadolibre:${(conn.config as Record<string, unknown>)?.seller_id}`,
    shopify_order_id: String(o.id),
    order_number: String(o.id),
    order_status_url: `https://www.mercadolibre.com.ar/ventas/${o.id}/detalle`,
    currency: o.currency_id ?? null,
    total_price: Number(o.total_amount ?? 0),
    line_items: (o.order_items ?? []).map((i) => ({
      title: i.item?.title ?? "",
      quantity: i.quantity ?? 1,
      price: i.unit_price ?? 0,
      item_id: i.item?.id ?? null,
    })),
    // Mercado Libre anonimiza al comprador: no hay nombre real, ni email, ni
    // teléfono. Se guarda el apodo porque es lo único con lo que el comercio
    // puede reconocerlo dentro de Mercado Libre.
    customer_name: o.buyer?.nickname ?? null,
    shipping_address: addr
      ? {
          city: addr.city?.name ?? null,
          province: addr.state?.name ?? null,
          zip: addr.zip_code ?? null,
          country: addr.country?.id ?? null,
        }
      : null,
    financial_status: financialStatus(o),
    fulfillment_status: shipment?.status === "delivered" ? "fulfilled" : null,
    status: lifecycle(o, shipment),
    tracking_number: shipment?.tracking_number ?? null,
    tracking_company: shipment?.tracking_method ?? null,
    tracking_url: shipment?.tracking_number
      ? `https://www.mercadolibre.com.ar/ventas/${o.id}/detalle`
      : null,
    shipping_status: shipment?.status ?? null,
    created_by: "sync",
    created_at: o.date_created ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await db
    .from("orders")
    .upsert(row, { onConflict: "workspace_id,shop_domain,shopify_order_id" });
  // Se propaga a propósito. La primera versión ignoraba este error y contaba
  // el pedido igual: el endpoint informaba 42 pedidos con 0 filas escritas
  // (el índice único era parcial y ON CONFLICT lo rechazaba). Un contador que
  // miente es peor que un fallo ruidoso.
  if (error) throw new Error(`orders upsert: ${error.message}`);
}

async function fetchShipment(
  id: number,
  auth: Record<string, string>,
): Promise<MlShipment | null> {
  try {
    const r = await fetch(`${ML}/shipments/${id}`, { headers: auth });
    if (!r.ok) return null;
    return (await r.json()) as MlShipment;
  } catch {
    return null;
  }
}

/** 'pending' | 'paid' | 'refunded' — el vocabulario del resto del producto. */
function financialStatus(o: MlOrder): string {
  const p = o.payments?.[0]?.status;
  if (p === "refunded" || p === "charged_back") return "refunded";
  if (p === "approved" || o.status === "paid") return "paid";
  return "pending";
}

/** Ciclo de vida del lado Riverz (CHECK de la migración 080). */
function lifecycle(o: MlOrder, s: MlShipment | null): string {
  if (o.status === "cancelled") return "cancelled";
  const p = o.payments?.[0]?.status;
  if (p === "refunded" || p === "charged_back") return "refunded";
  if (s?.status === "delivered") return "fulfilled";
  if (p === "approved" || o.status === "paid") return "paid";
  return "created";
}

/**
 * Mercado Libre quiere las fechas con offset explícito y milisegundos
 * (`2026-07-28T12:00:00.000-00:00`); un ISO con `Z` lo rechaza.
 */
function mlDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("Z", "-00:00");
}

/**
 * Reclamos abiertos. En Mercado Libre un reclamo sin atender pega directo en
 * la reputación del vendedor y corre contra reloj, así que vale traerlos
 * aunque todavía no haya una pantalla dedicada: primero existir, después
 * mostrarse.
 */
async function syncClaims(
  db: SupabaseClient,
  conn: ChannelConnection,
  auth: Record<string, string>,
): Promise<number> {
  try {
    const r = await fetch(`${ML}/post-purchase/v1/claims/search?status=opened&limit=50`, {
      headers: auth,
    });
    if (!r.ok) return 0;
    const j = (await r.json()) as {
      data?: Array<Record<string, unknown>>;
      results?: Array<Record<string, unknown>>;
    };
    const rows = j.data ?? j.results ?? [];
    let n = 0;
    for (const c of rows) {
      const claimId = String(c.id ?? "");
      if (!claimId) continue;
      const { error: claimErr } = await db.from("ml_claims").upsert(
        {
          workspace_id: conn.workspace_id,
          connection_id: conn.id,
          claim_id: claimId,
          resource_id: c.resource_id != null ? String(c.resource_id) : null,
          order_id: c.resource === "order" && c.resource_id ? String(c.resource_id) : null,
          stage: c.stage != null ? String(c.stage) : null,
          status: c.status != null ? String(c.status) : null,
          type: c.type != null ? String(c.type) : null,
          reason: c.reason_id != null ? String(c.reason_id) : null,
          opened_at: c.date_created != null ? String(c.date_created) : null,
          raw: c,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,claim_id" },
      );
      if (claimErr) continue;
      n++;
    }
    return n;
  } catch {
    return 0;
  }
}
