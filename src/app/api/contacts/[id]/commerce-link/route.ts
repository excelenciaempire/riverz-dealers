import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { getActiveShopifyConnection } from "@/lib/attribution/shopify";
import type { ShopifyCustomerSnapshot } from "@/types";

/**
 * GET /api/contacts/[id]/commerce-link
 *
 * "Ver la compra de esta persona", resuelto sabiendo DE DÓNDE viene la venta.
 *
 * Un mismo contacto puede haber comprado por la tienda o por Mercado Libre, y
 * cada pedido vive en un panel distinto; y quien todavía no compró puede tener
 * un carrito abierto, que es justo lo que el comercio quiere mirar antes de
 * contestarle. Orden de resolución:
 *
 *   1. Último pedido espejado en `orders` (trae contact_id y platform):
 *      Shopify → el pedido en el admin; Mercado Libre → el detalle de la venta.
 *   2. Snapshot Shopify del contacto: último pedido de `lifetime_orders` por
 *      id, o la ficha del cliente si el snapshot es viejo y no lo guardó.
 *   3. Carrito abandonado abierto: su enlace de recuperación.
 *   4. Nada: `{ url: null }` y el botón no se muestra.
 *
 * El acceso lo decide la RLS: el contacto se lee con la sesión del usuario, y
 * todo lo demás se filtra por el workspace de ESE contacto.
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

  const { data: contactRow } = await supabase
    .from("contacts")
    .select("id, workspace_id, phone, email, shopify_customer_data")
    .eq("id", id)
    .maybeSingle();
  const contact = contactRow as {
    id: string;
    workspace_id: string;
    phone: string | null;
    email: string | null;
    shopify_customer_data: ShopifyCustomerSnapshot | null;
  } | null;
  if (!contact) return NextResponse.json({ url: null }, { status: 404 });

  // 1) Último pedido ya espejado en Riverz, sea de la tienda o del marketplace.
  const { data: orderRow } = await supabase
    .from("orders")
    .select("platform, shop_domain, shopify_order_id, order_number, order_status_url")
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
    // Shopify es el único con dominio propio: su admin abre el pedido exacto.
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

  const admin = supabaseAdmin();
  const conn = await getActiveShopifyConnection(admin, contact.workspace_id);
  if (!conn) return NextResponse.json({ url: null });

  // 2) Lo que dejó la sincronización de contactos.
  const snap = contact.shopify_customer_data;
  const last = snap?.lifetime_orders?.[0];
  if (last?.id) {
    return NextResponse.json({
      url: `https://${conn.shopDomain}/admin/orders/${last.id}`,
      platform: "shopify",
      order_number: last.name ?? null,
      kind: "order",
    });
  }
  if (snap?.customer_id) {
    // Sin id de pedido, la ficha del cliente: desde ahí se ve su historial
    // completo. Mejor que un botón que no lleva a ningún lado.
    return NextResponse.json({
      url: `https://${conn.shopDomain}/admin/customers/${snap.customer_id}`,
      platform: "shopify",
      order_number: last?.name ?? null,
      kind: "customer",
    });
  }

  // 3) No compró: el carrito que dejó abierto. Es el caso más común en la
  //    bandeja — la persona escribe justamente por eso.
  const digits = (contact.phone ?? "").replace(/\D/g, "");
  let checkoutQuery = admin
    .from("shopify_checkouts")
    .select("abandoned_checkout_url, created_at")
    .eq("workspace_id", contact.workspace_id)
    .eq("status", "open")
    .not("abandoned_checkout_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (contact.email) {
    checkoutQuery = checkoutQuery.eq("customer_email", contact.email);
  } else if (digits.length >= 8) {
    // Los últimos 8 dígitos son la parte que no cambia entre formatos
    // (0/15 argentino, prefijo con o sin +).
    checkoutQuery = checkoutQuery.like("customer_phone", `%${digits.slice(-8)}`);
  } else {
    return NextResponse.json({ url: null });
  }
  const { data: checkoutRow } = await checkoutQuery.maybeSingle();
  const checkoutUrl = (checkoutRow as { abandoned_checkout_url?: string } | null)
    ?.abandoned_checkout_url;
  if (checkoutUrl) {
    return NextResponse.json({
      url: checkoutUrl,
      platform: "shopify",
      order_number: null,
      kind: "checkout",
    });
  }

  return NextResponse.json({ url: null });
}
