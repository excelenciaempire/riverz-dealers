import { NextResponse } from "next/server";
import { pollAllMercadoLibreReviews } from "@/lib/channels/ml_review/poll";
import { assertCronAuth } from "@/lib/auth/cron";
import { withCronRun } from "@/lib/cron/heartbeat";

/**
 * Trae las opiniones nuevas de las publicaciones de Mercado Libre.
 *
 * Va aparte del sondeo de preguntas (`mercadolibre-poll`) porque tiene otro
 * ritmo: una pregunta sin contestar cuesta una venta en minutos, una opinión
 * es algo que se lee. Cada 30 minutos sobra, y así el conteo por publicación
 * no castiga la cuota de la API.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }
  try {
    const result = await pollAllMercadoLibreReviews();
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = withCronRun("ml-reviews", cronHandler);
