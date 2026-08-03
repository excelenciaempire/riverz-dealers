import { NextResponse } from "next/server";

import { assertCronAuth } from "@/lib/auth/cron";
import { schedulerStatus, startScheduler } from "@/lib/cron/scheduler";

/**
 * Latido que mantiene despierto el servicio.
 *
 * En el plan free de Render la instancia se apaga tras 15 minutos sin tráfico
 * entrante, y una instancia dormida no puede despertarse sola: si nadie la
 * golpea, el reloj interno de `scheduler.ts` deja de existir y ningún trabajo
 * periódico corre. Por eso queda UN cron job externo (el único que se paga)
 * pegándole a esta ruta cada 10 minutos.
 *
 * Además vuelve a arrancar el reloj si el proceso se reinició, así que el
 * peor caso tras un reinicio es perder hasta 10 minutos de trabajos, no que
 * queden muertos hasta el próximo deploy.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  startScheduler();
  return NextResponse.json({ ok: true, ...schedulerStatus() });
}
