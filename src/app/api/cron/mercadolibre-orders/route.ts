import { NextResponse } from "next/server";
import { syncAllMercadoLibreOrders } from "@/lib/channels/mercadolibre/orders";
import { syncAllMercadoLibreCatalogs } from "@/lib/channels/mercadolibre/catalog";
import { assertCronAuth } from "@/lib/auth/cron";
import { withCronRun } from "@/lib/cron/heartbeat";

/**
 * Espeja los pedidos, envíos y reclamos de Mercado Libre.
 *
 * Va aparte del sondeo de preguntas porque mide otra cosa: una pregunta sin
 * contestar cuesta una venta en minutos; un pedido ya vendido sólo cambia de
 * estado. Cada 15 minutos alcanza, y el webhook (orders_v2 / shipments /
 * claims) cubre lo urgente en tiempo real — esto es la red que recoge lo que
 * el webhook pierda.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }
  try {
    const [orders, catalog] = await Promise.all([
      syncAllMercadoLibreOrders(),
      // El catálogo va en la misma corrida: son pocas publicaciones y el
      // agente necesita precio y stock frescos tanto como el estado del pedido.
      syncAllMercadoLibreCatalogs().catch(() => ({ sellers: 0, products: 0 })),
    ]);
    return NextResponse.json({ ...orders, products: catalog.products }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = withCronRun("mercadolibre-orders", cronHandler);
