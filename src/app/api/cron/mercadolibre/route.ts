import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { pollAllMercadoLibreConnections } from "@/lib/channels/mercadolibre/poll";
import { syncAllMercadoLibreOrders } from "@/lib/channels/mercadolibre/orders";
import { syncAllMercadoLibreCatalogs } from "@/lib/channels/mercadolibre/catalog";
import { pollAllMercadoLibreReviews } from "@/lib/channels/ml_review/poll";
import { assertCronAuth } from "@/lib/auth/cron";
import { withCronRun, pingCron } from "@/lib/cron/heartbeat";

/**
 * TODO Mercado Libre en un solo trabajo.
 *
 * Uno y no cuatro a propósito: Render factura un mínimo mensual POR cron, y
 * cada corrida cuesta casi lo mismo en tiempo de arranque del contenedor que
 * en trabajo real. Cuatro servicios para un solo comercio serían cuatro
 * mínimos para mover los mismos datos.
 *
 * Dentro, cada cosa corre a su propio ritmo — mismo patrón que `comment-sync`,
 * con el reloj en `cron_runs`:
 *
 *   preguntas  — SIEMPRE. Una pregunta sin contestar cuesta una venta en
 *                minutos, y Mercado Libre penaliza la demora.
 *   pedidos    — cada ~15 min. Ya está vendido: sólo cambia de estado, y el
 *                webhook (orders_v2 / shipments / claims) adelanta lo urgente.
 *   catálogo   — cada ~60 min. Precio y stock no cambian por minuto.
 *   opiniones  — cada ~60 min. Una petición de conteo por publicación.
 */

const JOB_ORDERS = "mercadolibre-orders";
const JOB_CATALOG = "mercadolibre-catalog";
const JOB_REVIEWS = "ml-reviews";

// Umbrales por debajo del intervalo nominal: con el cron cada 5 minutos, un
// umbral de exactamente 15 se pasaría de largo hasta la corrida siguiente.
const EVERY_ORDERS_MS = 14 * 60_000;
const EVERY_SLOW_MS = 58 * 60_000;

async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const db = supabaseAdmin();
  const out: Record<string, unknown> = {};

  // ── Lo urgente, siempre ──
  out.questions = await pollAllMercadoLibreConnections().catch((err) => ({
    error: err instanceof Error ? err.message : String(err),
  }));

  // ── Pedidos, envíos y reclamos ──
  if (await isDue(db, JOB_ORDERS, EVERY_ORDERS_MS)) {
    // El ping va ANTES del trabajo: es el reloj del que depende la próxima
    // corrida, y dejarlo para el final permitiría que dos seguidas se crean
    // con derecho si la primera tarda.
    await pingCron(JOB_ORDERS);
    out.orders = await syncAllMercadoLibreOrders().catch((err) => ({
      error: err instanceof Error ? err.message : String(err),
    }));
  }

  // ── Catálogo ──
  if (await isDue(db, JOB_CATALOG, EVERY_SLOW_MS)) {
    await pingCron(JOB_CATALOG);
    out.catalog = await syncAllMercadoLibreCatalogs().catch((err) => ({
      error: err instanceof Error ? err.message : String(err),
    }));
  }

  // ── Opiniones ──
  if (await isDue(db, JOB_REVIEWS, EVERY_SLOW_MS)) {
    await pingCron(JOB_REVIEWS);
    out.reviews = await pollAllMercadoLibreReviews().catch((err) => ({
      error: err instanceof Error ? err.message : String(err),
    }));
  }

  return NextResponse.json(out, { status: 200 });
}

/** ¿Pasó ya el intervalo desde la última vez que corrió este sub-trabajo? */
async function isDue(
  db: ReturnType<typeof supabaseAdmin>,
  job: string,
  everyMs: number,
): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("cron_runs")
      .select("started_at")
      .eq("name", job)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return true;
    const last = Date.parse((data as { started_at: string }).started_at);
    if (!Number.isFinite(last)) return true;
    return Date.now() - last >= everyMs;
  } catch {
    // Ante la duda, correr. Perder una sincronización es peor que repetirla:
    // todo lo de abajo es idempotente.
    return true;
  }
}

export const GET = withCronRun("mercadolibre", cronHandler);
