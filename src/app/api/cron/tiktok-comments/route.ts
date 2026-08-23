import { NextResponse } from "next/server";
import { pollAllTikTokConnections } from "@/lib/channels/tiktok_comment/poll";
import { transcribirPendientes } from "@/lib/channels/tiktok_comment/videos";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { ensureTikTokCommentWebhook } from "@/lib/channels/tiktok_comment/webhook-subscribe";
import { assertCronAuth } from "@/lib/auth/cron";
import { withCronRun } from "@/lib/cron/heartbeat";

/**
 * GET /api/cron/tiktok-comments
 *
 * Polls each connected TikTok Business Account's recent videos for new
 * customer comments and ingests them into the unified inbox (idempotent on
 * comment_id). Also keeps the 24h access tokens fresh as a side effect.
 * Auth: `x-cron-secret` header must match `AUTOMATION_CRON_SECRET`.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  try {
    // El webhook se registra desde acá (TikTok no lo configura en el portal:
    // es una llamada a su API). Va primero y es barato — se saltea solo salvo
    // en el primer arranque o cada 6 h.
    const webhook = await ensureTikTokCommentWebhook();
    // `?deep=1` barre TODO el catálogo de videos, no sólo los 10 más nuevos:
    // un comentario sobre un video de hace semanas no entra de otra forma.
    // Es caro (una llamada por video), así que corre cada 6 h por su propia
    // entrada en el catálogo de crons, no cada minuto.
    const deep = new URL(request.url).searchParams.get("deep") === "1";
    const result = await pollAllTikTokConnections({ deep });

    // Lo que DICE el video, para que contestar un comentario no sea adivinar.
    // Pocos por corrida: cada uno es una descarga más unos segundos de
    // Whisper, y lo que importa es que el video de hoy —el que está juntando
    // comentarios— esté transcripto pronto, no vaciar la cola de una vez.
    const transcripcion = await transcribirPendientes(supabaseAdmin(), {
      limite: deep ? 8 : 2,
    }).catch((err) => {
      console.error("[tiktok/cron] transcripción falló:", err);
      return { intentados: 0, transcriptos: 0 };
    });

    return NextResponse.json(
      { ...result, deep, webhook, transcripcion },
      { status: 200 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Registra la corrida en cron_runs con duración y resultado reales. El
 *  barrido profundo lleva nombre propio: corre cada 6 h y tarda mucho más,
 *  así que mezclarlo con el poll de cada minuto haría ilegible el panel. */
const runShallow = withCronRun("tiktok-comments", cronHandler);
const runDeep = withCronRun("tiktok-comments-deep", cronHandler);

export const GET = (request: Request): Promise<Response> =>
  new URL(request.url).searchParams.get("deep") === "1"
    ? runDeep(request)
    : runShallow(request);
