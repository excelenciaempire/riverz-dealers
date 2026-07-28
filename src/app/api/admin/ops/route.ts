import { adminGet } from '@/lib/admin/route';
import { getOpsStatus } from '@/lib/admin/queries';
import { CRON_SCHEDULES, undeclaredCrons } from '@/lib/admin/crons';

export const dynamic = 'force-dynamic';

/** Estado de los trabajos de fondo: crons y cola de webhooks. */
export async function GET(request: Request) {
  return adminGet(request, { action: 'view.ops' }, async () => {
    const status = await getOpsStatus();
    return {
      ...status,
      schedules: CRON_SCHEDULES,
      undeclared: undeclaredCrons(),
    };
  });
}
