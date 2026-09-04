import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { reconcileAllCommentConnections } from "@/lib/channels/comment-sync";
import {
  pullCommentsAll,
  pullCommentsForWorkspace,
} from "@/lib/channels/comment-pull";
import { entenderPendientes, identificarProductosPendientes } from "@/lib/channels/publicacion-media";
import { assertCronAuth } from "@/lib/auth/cron";
import { pingCron, withCronRun } from "@/lib/cron/heartbeat";

/**
 * GET /api/cron/comment-sync
 *
 * Two-way comment sync (pull side), con DOS ritmos en un solo cron:
 *
 *   - Cada corrida — comentarios de clientes y respuestas que el comercio
 *     escribió desde la app de Instagram / Facebook, en los DOS canales. Es
 *     sólo una RED DE SEGURIDAD: medido en producción el 2026-07-27, un
 *     comentario llega por webhook en ~1 segundo. Esto recoge lo que el webhook
 *     pierda (una entrega sin reintento, una caída, la suscripción de Meta
 *     apuntando a un dominio que ya no existe). Cuesta ~1 llamada a Graph por
 *     publicación.
 *   - Cada ~10 min — reconciliación de borrados / ocultos (hasta 300 sondeos a
 *     Graph por cuenta). Instagram no emite webhook de borrado/ocultado, así
 *     que acá el pull no es respaldo: es el único camino.
 *
 * Los dos ritmos viven en el MISMO cron a propósito: Render cobra un mínimo
 * mensual por cada cron job, así que partirlo en dos servicios costaría plata
 * para hacer exactamente lo mismo. El reloj del trabajo caro sale de
 * `cron_runs` (el mismo heartbeat que ya alimenta /api/health/crons).
 *
 * Auth: `x-cron-secret` header must match `AUTOMATION_CRON_SECRET`.
 */

/** Nombre propio del trabajo caro en `cron_runs` — su reloj es independiente. */
const RECONCILE_JOB = "comment-sync-reconcile";
/** Cada cuánto reconciliar. Nueve y no diez: con el cron cada 2 minutos, un
 *  umbral de exactamente 10 se pasaría de largo hasta la corrida siguiente. */
const RECONCILE_EVERY_MS = 9 * 60_000;

async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  try {
    const db = supabaseAdmin();

    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspace_id")?.trim();
    const backfillDays = Number(url.searchParams.get("backfill_days"));
    // Recuperación explícita y acotada para una sola cuenta. Es siempre pasiva:
    // los comentarios importados no despiertan reglas ni respuestas automáticas.
    if (workspaceId && Number.isFinite(backfillDays) && backfillDays > 0) {
      if (backfillDays > 90) {
        return NextResponse.json(
          { error: "backfill_days debe estar entre 1 y 90" },
          { status: 400 },
        );
      }
      const pulled = await pullCommentsForWorkspace(db, workspaceId, {
        windowMs: backfillDays * 24 * 60 * 60 * 1000,
        maxPosts: 100,
        suppressAutoReply: true,
      });
      return NextResponse.json(
        { ok: true, backfill: true, days: backfillDays, pulled },
        { status: 200 },
      );
    }

    // Lo barato y urgente, siempre.
    const pulled = await pullCommentsAll(db).catch((err) => {
      console.error("[comment-sync] pull de comentarios falló:", err);
      return { connections: 0, ingestedInbound: 0, ingested: 0, seen: 0, detail: [] };
    });

    // Entender la publicación: qué muestra la foto, qué se dice en el video.
    // Viaja acá y no en un cron propio porque Render cobra un mínimo mensual
    // por cada cron job, y el trabajo es el mismo: mirar lo que la gente está
    // comentando. Tope chico por corrida — lo que importa es que el post de
    // hoy se entienda pronto, no vaciar la cola de una sentada.
    const publicaciones = await entenderPendientes(db, { limite: 4 }).catch((err) => {
      console.error("[comment-sync] entender publicaciones falló:", err);
      return { intentados: 0, entendidos: 0 };
    });
    const productosDePublicaciones = await identificarProductosPendientes(db, { limite: 12 }).catch((err) => {
      console.error("[comment-sync] identificar productos de publicaciones falló:", err);
      return { intentados: 0, identificados: 0 };
    });

    // Lo caro, sólo cuando toca.
    const due = await reconcileIsDue(db);
    if (!due) {
      return NextResponse.json(
        { ok: true, reconciled: false, pulled, publicaciones, productosDePublicaciones },
        { status: 200 },
      );
    }
    // Este SÍ se espera: es el reloj del que depende la próxima corrida, y
    // dejarlo suelto abriría la puerta a que dos seguidas se crean con derecho.
    await pingCron(RECONCILE_JOB);
    const result = await reconcileAllCommentConnections(db);
    return NextResponse.json(
      { ...result, reconciled: true, pulled, publicaciones, productosDePublicaciones },
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

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("comment-sync", cronHandler);
