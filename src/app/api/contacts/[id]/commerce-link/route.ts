import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { resolveWorkspaceIdForUser } from "@/lib/workspaces/resolve";
import { getActiveShopifyConnection } from "@/lib/attribution/shopify";
import type { ShopifyCustomerSnapshot } from "@/types";

/**
 * GET /api/contacts/[id]/commerce-link
 *
 * "Ver el pedido de esta persona", resuelto sabiendo DE DÓNDE viene la venta.
 *
 * Un mismo contacto puede haber comprado por la tienda o por Mercado Libre, y
 * cada pedido vive en un panel distinto. El orden de resolución es:
 *
 *   1. El último pedido espejado en `orders` (tiene contact_id y platform):
 *      Shopify → admin del pedido; Mercado Libre → detalle de la venta.
 *   2. Si no hay pedido espejado, el snapshot Shopify del contacto: el último
 *      pedido de `lifetime_orders` (por id) o, sin id, la ficha del cliente.
 *   3. Nada: la respuesta es `{ url: null }` y el botón no se muestra.
 *
 * RLS scopea la lectura de `contacts`/`orders` al workspace de quien llama.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ url: null }, { status: 401 });

  // 1) Último pedido ya espejado en Riverz, sea de la tienda o del marketplace.
  const { data: orderRow } = await supabase
    .from("orders")
    .select(
      "platform, shop_domain, shopify_order_id, order_number, order_status_url, created_at",
    )
    .eq("contact_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const order = orderRow as {
    platform: string | null;
    shop_domain: string | null;
    shopify_order_id: string | null;
    order_number: string | null;
    order_status_url: string | null;
  } | null;

  if (order) {
    const platform = order.platform ?? "shopify";
    // Shopify es el único con dominio real: su admin abre el pedido exacto.
    const url =
      platform === "shopify" && order.shop_domain && order.shopify_order_id
        ? `https://${order.shop_domain}/admin/orders/${order.shopify_order_id}`
        : order.order_status_url;
    if (url) {
      return NextResponse.json({
        url,
        platform,
        order_number: order.order_number,
        kind: "order",
      });
    }
  }

  // 2) Sin pedido espejado: lo que dejó la sincronización de contactos.
  const { data: contactRow } = await supabase
    .from("contacts")
    .select("shopify_customer_data")
    .eq("id", id)
    .maybeSingle();
  const snap = (contactRow as { shopify_customer_data?: ShopifyCustomerSnapshot } | null)
    ?.shopify_customer_data;
  if (!snap) return NextResponse.json({ url: null });

  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  const conn = workspaceId ? await getActiveShopifyConnection(admin, workspaceId) : null;
  if (!conn) return NextResponse.json({ url: null });

  const last = snap.lifetime_orders?.[0];
  if (last?.id) {
    return NextResponse.json({
      url: `https://${conn.shopDomain}/admin/orders/${last.id}`,
      platform: "shopify",
      order_number: last.name ?? null,
      kind: "order",
    });
  }
  if (snap.customer_id) {
    // Sin id de pedido, la ficha del cliente en el admin: desde ahí se ve su
    // historial completo. Mejor que un botón que no lleva a ningún lado.
    return NextResponse.json({
      url: `https://${conn.shopDomain}/admin/customers/${snap.customer_id}`,
      platform: "shopify",
      order_number: last?.name ?? null,
      kind: "customer",
    });
  }
  return NextResponse.json({ url: null });
}
