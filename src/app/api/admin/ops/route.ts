import { adminGet } from '@/lib/admin/route';
import { getOpsStatus } from '@/lib/admin/queries';
import { cronCatalog } from '@/lib/admin/crons';
import { schedulerStatus } from '@/lib/cron/scheduler';

export const dynamic = 'force-dynamic';

/**
 * Estado de los trabajos de fondo: el reloj, los crons y la cola de webhooks.
 *
 * El latido del reloj (`schedulerStatus`) es lo que distingue "este cron no
 * reportó" de "no hay reloj". Existía desde que los trabajos se mudaron adentro
 * de la app y sólo lo servía `/api/cron/tick`, que pide el secreto de los crons
 * y por lo tanto no era consultable desde el panel.
 *
 * Ojo: el estado vive en `globalThis`, o sea por proceso. Con una sola
 * instancia del servicio esto es la verdad; si algún día se escala en
 * horizontal, cada instancia va a contestar por su propio reloj.
 */
export async function GET(request: Request) {
  return adminGet(request, { action: 'view.ops' }, async () => {
    const status = await getOpsStatus();
    return {
      ...status,
      schedules: cronCatalog(),
      scheduler: schedulerStatus(),
    };
  });
}
