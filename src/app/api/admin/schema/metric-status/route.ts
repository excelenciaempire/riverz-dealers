import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { csrfGuard } from '@/lib/csrf';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';

export const dynamic = 'force-dynamic';

/**
 * Aplica la corrección acotada de métricas desde el entorno que ya custodia
 * las credenciales de Supabase. Es deliberadamente específica: no acepta SQL
 * del cliente y por tanto no convierte el admin en una consola de base de
 * datos. La ruta se retira en cuanto producción confirma la migración.
 */
export async function POST(request: Request) {
  const blocked = await csrfGuard(request);
  if (blocked) return blocked;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const project = process.env.SUPABASE_PROJECT_REF?.trim() ||
    (publicUrl ? new URL(publicUrl).hostname.split('.')[0] : '');
  if (!token || !project) {
    return NextResponse.json({ error: 'supabase_management_not_configured' }, { status: 503 });
  }

  const query = await readFile(
    join(process.cwd(), 'supabase', 'migrations', '293_admin_metric_status_accuracy.sql'),
    'utf8',
  );
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(project)}/database/query`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return NextResponse.json({
      error: 'supabase_migration_failed',
      detail: detail.slice(0, 300),
    }, { status: 502 });
  }

  await recordAdminAction(gate.actor, request, {
    action: 'update.admin_metric_schema',
    targetType: 'schema_migration',
    targetId: '293_admin_metric_status_accuracy',
  });
  return NextResponse.json({ ok: true, migration: '293_admin_metric_status_accuracy' });
}
