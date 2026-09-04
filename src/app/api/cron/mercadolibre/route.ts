import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { pollAllMercadoLibreConnections } from "@/lib/channels/mercadolibre/poll";
import { pollAllMercadoLibreMessages } from "@/lib/channels/mercadolibre/messages-poll";
import { syncAllMercadoLibreOrders } from "@/lib/channels/mercadolibre/orders";
import { syncAllMercadoLibreCatalogs } from "@/lib/channels/mercadolibre/catalog";
import { pollAllMercadoLibreReviews } from "@/lib/channels/mercadolibre/reviews";
import { pollAllMercadoLibreClaims } from "@/lib/channels/mercadolibre/claims-poll";
import { assertCronAuth } from "@/lib/auth/cron";
import { withCronRun, withCronTask } from "@/lib/cron/heartbeat";
import { hasMercadoLibreFailures } from "@/lib/channels/mercadolibre/sync-result";

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
 *   mensajes   — SIEMPRE, por lo mismo. Y porque la notificación de Mercado
 *                Libre no es de fiar: `notifications_callback_url` es un solo
 *                campo por aplicación, se configura a mano y si apunta a otro
 *                lado no llega nada sin que nada falle. Medido el 2026-08-05:
 *                cero mensajes post-venta habían entrado por notificación.
 *   pedidos    — cada ~15 min. Ya está vendido: sólo cambia de estado, y el
 *                webhook (orders_v2 / shipments / claims) adelanta lo urgente.
 *   catálogo   — cada ~60 min. Precio y stock no cambian por minuto.
 *   opiniones  — cada ~60 min. Una petición de conteo por publicación.
 *   reclamos   — cada ~10 min. La mediación corre contra reloj: se traen el
 *                expediente Y los mensajes, incluidas las respuestas que el
 *                vendedor dio desde Mercado Libre.
 */

const JOB_ORDERS = "mercadolibre-orders";
const JOB_CATALOG = "mercadolibre-catalog";
const JOB_REVIEWS = "ml-reviews";
const JOB_CLAIMS = "mercadolibre-claims";

// Umbrales por debajo del intervalo nominal: con el cron cada 5 minutos, un
// umbral de exactamente 15 se pasaría de largo hasta la corrida siguiente.
const EVERY_ORDERS_MS = 14 * 60_000;
const EVERY_SLOW_MS = 58 * 60_000;
// Los reclamos, cada ~10 min: más seguido que los pedidos porque acá cada
// respuesta cuenta, y menos que las preguntas porque son dos búsquedas por
// vendedor contra una cuota que comparten todos los comercios.
const EVERY_CLAIMS_MS = 9 * 60_000;

async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const db = supabaseAdmin();
  const out: Record<string, unknown> = {};
  // Recuperación operativa: permite forzar una pasada completa autenticada
  // después de una caída o un despliegue, sin esperar los relojes internos.
  const force = new URL(request.url).searchParams.get("force") === "1";

  // ── Lo urgente, siempre ──
  out.questions = await pollAllMercadoLibreConnections().catch((err) => ({
    error: err instanceof Error ? err.message : String(err),
  }));
  // Los mensajes post-venta también van en cada corrida: un comprador que
  // pregunta por su envío espera respuesta hoy, no en quince minutos. Cuesta
  // una llamada por los no leídos más una por los pedidos de la semana.
  out.messages = await pollAllMercadoLibreMessages().catch((err) => ({
    error: err instanceof Error ? err.message : String(err),
  }));

  // ── Pedidos, envíos y reclamos ──
  if (force || (await isDue(db, JOB_ORDERS, EVERY_ORDERS_MS))) {
    // El ping va ANTES del trabajo: es el reloj del que depende la próxima
    // corrida, y dejarlo para el final permitiría que dos seguidas se crean
    // con derecho si la primera tarda.
    // Los reclamos tienen su propia pasada debajo. El sincronizador de pedidos
    // los conserva por defecto para el webhook, pero acá duplicaría llamadas.
    out.orders = await runSubtask(JOB_ORDERS, () => syncAllMercadoLibreOrders({ includeClaims: false }));
  }

  // ── Reclamos ──
  //
  // Fuera del bloque de pedidos y a su propio ritmo: una mediación corre contra
  // reloj y lo que se diga ahí decide si se devuelve la plata, así que no puede
  // esperar a la corrida de pedidos. Cuesta dos búsquedas por vendedor más los
  // mensajes de los que cambiaron.
  if (force || (await isDue(db, JOB_CLAIMS, EVERY_CLAIMS_MS))) {
    out.claims = await runSubtask(JOB_CLAIMS, pollAllMercadoLibreClaims);
  }

  // ── Catálogo ──
  if (force || (await isDue(db, JOB_CATALOG, EVERY_SLOW_MS))) {
    out.catalog = await runSubtask(JOB_CATALOG, syncAllMercadoLibreCatalogs);
  }

  // ── Opiniones ──
  if (force || (await isDue(db, JOB_REVIEWS, EVERY_SLOW_MS))) {
    out.reviews = await runSubtask(JOB_REVIEWS, pollAllMercadoLibreReviews);
  }

  const failed = Object.values(out).filter((value) => hasMercadoLibreFailures(value) || hasError(value)).length;
  return NextResponse.json(
    {
      ok: failed === 0,
      ...out,
      failed,
      ...(failed ? { error: `${failed} sincronizaciones de Mercado Libre con errores` } : {}),
    },
    { status: failed ? 207 : 200 }
  );
}

function hasError(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "error" in value);
}

/** Conserva el resultado parcial, pero registra el subtrabajo como error. */
async function runSubtask<T>(name: string, task: () => Promise<T>): Promise<T | { error: string }> {
  let result: T | undefined;
  try {
    return await withCronTask(name, async () => {
      result = await task();
      if (hasMercadoLibreFailures(result)) {
        const count = (result as { failures: unknown[] }).failures.length;
        throw new Error(`${count} conexiones con errores`);
      }
      return result;
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return result && typeof result === "object" ? { ...result, error } : { error };
  }
}

/** ¿Pasó ya el intervalo desde la última vez que corrió este sub-trabajo? */
async function isDue(db: ReturnType<typeof supabaseAdmin>, job: string, everyMs: number): Promise<boolean> {
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
