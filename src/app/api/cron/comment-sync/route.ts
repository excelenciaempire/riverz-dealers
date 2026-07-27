import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { reconcileAllCommentConnections } from "@/lib/channels/comment-sync";
import { pullSelfRepliesAll } from "@/lib/channels/comment-pull";
import { assertCronAuth } from "@/lib/auth/cron";
import { pingCron } from "@/lib/cron/heartbeat";

/**
 * GET /api/cron/comment-sync
 *
 * Two-way comment sync (pull side), con DOS ritmos en un solo cron:
 *
 *   - Cada corrida (*​/2 min) — respuestas que el comercio escribió DESDE
 *     Instagram. Meta no notifica los comentarios de la cuenta dueña del post,
 *     así que la única forma de verlas es ir a buscarlas; son ~1 llamada a
 *     Graph por publicación con actividad, o sea barato de correr seguido.
 *   - Cada ~10 min — reconciliación de borrados / ocultos (hasta 300 sondeos a
 *     Graph por cuenta). Correrla cada 2 minutos multiplicaría por cinco el
 *     consumo contra Meta sin ganar nada: nadie necesita ver un comentario
 *     borrado al instante, pero sí su propia respuesta.
 *
 * Los dos ritmos viven en el MISMO cron a propósito: Render cobra un mínimo
 * mensual por cada cron job, así que partirlo en dos servicios costaría plata
 * para hacer exactamente lo mismo. El reloj del trabajo caro sale de
 * `cron_runs` (el mismo heartbeat que ya alimenta /api/health/crons).
 *
 * Facebook no depende de nada de esto: sus comentarios, respuestas y
 * borrados llegan en vivo por el webhook `feed`.
 *
 * Auth: `x-cron-secret` header must match `AUTOMATION_CRON_SECRET`.
 */

/** Nombre propio del trabajo caro en `cron_runs` — su reloj es independiente. */
const RECONCILE_JOB = "comment-sync-reconcile";
/** Cada cuánto reconciliar. Nueve y no diez: con el cron cada 2 minutos, un
 *  umbral de exactamente 10 se pasaría de largo hasta la corrida siguiente. */
const RECONCILE_EVERY_MS = 9 * 60_000;

export async function GET(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }
  void pingCron("comment-sync");

  try {
    const db = supabaseAdmin();

    // Lo barato y urgente, siempre.
    const selfReplies = await pullSelfRepliesAll(db).catch((err) => {
      console.error("[comment-sync] pull de respuestas propias falló:", err);
      return { connections: 0, ingested: 0, seen: 0, detail: [] };
    });

    // Lo caro, sólo cuando toca.
    const due = await reconcileIsDue(db);
    if (!due) {
      return NextResponse.json(
        { ok: true, reconciled: false, selfReplies },
        { status: 200 },
      );
    }
    // Este SÍ se espera: es el reloj del que depende la próxima corrida, y
    // dejarlo suelto abriría la puerta a que dos seguidas se crean con derecho.
    await pingCron(RECONCILE_JOB);
    const result = await reconcileAllCommentConnections(db);
    return NextResponse.json(
      { ...result, reconciled: true, selfReplies },
      { status: 200 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * ¿Pasaron ya los ~10 minutos desde la última reconciliación? Ante cualquier
 * duda —tabla ausente, consulta fallida, nunca corrió— devuelve true: correr
 * de más es sólo gasto de llamadas, correr de menos deja comentarios borrados
 * visibles en la bandeja.
 */
async function reconcileIsDue(
  db: ReturnType<typeof supabaseAdmin>,
): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("cron_runs")
      .select("started_at")
      .eq("name", RECONCILE_JOB)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return true;
    const last = Date.parse((data as { started_at: string }).started_at);
    if (!Number.isFinite(last)) return true;
    return Date.now() - last >= RECONCILE_EVERY_MS;
  } catch {
    return true;
  }
}
