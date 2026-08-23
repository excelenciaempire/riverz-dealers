import { NextResponse } from "next/server";
import { transcribirPendientes } from "@/lib/channels/tiktok_comment/videos";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { assertCronAuth } from "@/lib/auth/cron";
import { withCronRun } from "@/lib/cron/heartbeat";

/**
 * GET /api/cron/tiktok-transcripciones
 *
 * Transcribe los videos de TikTok que todavía no tienen texto.
 *
 * Tiene cron propio y no viaja de prestado dentro del poll de comentarios por
 * dos razones: en el panel se ve si se atrasa —un trabajo sin nombre es un
 * trabajo que nadie mira—, y un video recién publicado queda transcripto en
 * minutos en vez de esperar al barrido de seis horas. Que importa: los
 * comentarios llegan sobre todo en las primeras horas del video, que es
 * justo cuando conviene tener su guion a mano para contestarlos.
 *
 * Idempotente y barato en vacío: sin pendientes devuelve enseguida. Se
 * transcribe UNA vez por video.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  try {
    // Seis por corrida cada quince minutos: 24 videos por hora, muy por
    // encima de lo que publica cualquier cuenta, y sin dejar la corrida
    // colgada más de un par de minutos.
    const resultado = await transcribirPendientes(supabaseAdmin(), { limite: 6 });
    return NextResponse.json(resultado, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = withCronRun("tiktok-transcripciones", cronHandler);
