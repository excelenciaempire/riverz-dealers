import { adminGet } from '@/lib/admin/route';
import { collectPlatformIssues } from '@/lib/health/issues';
import { supabaseAdmin } from '@/lib/channels/admin-client';

export const dynamic = 'force-dynamic';

/**
 * Cuántos comercios tienen algo roto AHORA.
 *
 * Salió de `/api/admin/overview` porque era lo único lento de aquel
 * `Promise.all`: `collectPlatformIssues()` cruza los avisos de TODAS las
 * cuentas, y mientras tanto los KPIs y las sparklines —que ya estaban
 * calculados— se quedaban esperando y el home mostraba un esqueleto entero.
 *
 * Devuelve sólo los dos números que pinta el home. El detalle por comercio ya
 * vive en /admin/comercios, que es donde se puede hacer algo con él.
 */
export async function GET(request: Request) {
  return adminGet(request, { action: 'view.overview' }, async () => {
    const issues = await collectPlatformIssues(supabaseAdmin());
    const critical = [...issues.values()].filter((list) =>
      list.some((i) => i.severity === 'critical'),
    ).length;

    return {
      workspacesWithIssues: issues.size,
      workspacesCritical: critical,
    };
  });
}
