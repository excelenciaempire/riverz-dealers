import { NextResponse } from "next/server";

import { assertCronAuth } from "@/lib/auth/cron";
import { schedulerStatus, startScheduler } from "@/lib/cron/scheduler";

/**
 * Diagnóstico del reloj de trabajos periódicos: dice si está vivo, cuántos
 * trabajos tiene en el inventario, cuándo fue el último tick y cuáles están
 * corriendo ahora mismo. Útil para responder "¿por qué no corrió X?" sin
 * bucear en los logs.
 *
 * Nació como latido: mientras el servicio estuvo en el plan free de Render, la
 * instancia se apagaba tras 15 min sin tráfico entrante y no podía despertarse
 * sola, así que un cron externo le pegaba cada 10 min para mantener el reloj
 * con vida. Desde que el web está en starter no hay apagado y ese cron se
 * borró. **Si el servicio vuelve a free, hay que volver a crearlo** o los
 * trabajos dejan de correr apenas la instancia se duerma.
 *
 * Arranca el reloj si el proceso se reinició, así que golpear esta ruta
 * también sirve para revivirlo a mano.
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
