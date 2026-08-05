import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { reconcileAllCommerceWebhooks } from "@/lib/commerce/webhook-reconcile";
import { assertCronAuth } from "@/lib/auth/cron";
import { withCronRun } from "@/lib/cron/heartbeat";

/**
 * GET /api/cron/commerce-webhooks
 *
 * Mantiene vivos los webhooks de las tiendas conectadas (Shopify, Tiendanube,
 * WooCommerce). Las tres registran su URL UNA VEZ, al conectar, y nunca la
 * vuelven a mirar: cuando el servicio cambia de dominio, la tienda sigue
 * entregando pedidos y carritos a un servidor muerto y del lado de Riverz no
 * falla nada — simplemente dejan de llegar.
 *
 * Es el hermano de `meta-webhook-subscriptions`, con la misma postura: reaplica,
 * verifica, y devuelve 207 si alguna tienda quedó sin reconciliar para que el
 * panel la marque en rojo en vez de mostrar todo verde.
 *
 * Auth: `x-cron-secret` contra AUTOMATION_CRON_SECRET. Idempotente.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const result = await reconcileAllCommerceWebhooks(supabaseAdmin());
  const failed = result.results.filter((r) => r.error);
  return NextResponse.json(
    { ok: failed.length === 0, ...result, failed: failed.length },
    { status: failed.length > 0 ? 207 : 200 },
  );
}

export const GET = withCronRun("commerce-webhooks", cronHandler);
