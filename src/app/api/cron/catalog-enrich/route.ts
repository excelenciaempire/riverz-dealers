import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { enrichProducts } from '@/lib/products/enrich';
import { unificarLoObvio } from '@/lib/products/unify';
import { assertCronAuth } from '@/lib/auth/cron';
import { withCronRun } from '@/lib/cron/heartbeat';

/**
 * GET /api/cron/catalog-enrich
 *
 * Le lee la página a los productos que todavía no la tienen, y une los que son
 * el mismo producto en dos plataformas.
 *
 * Las dos cosas ya ocurrían, pero SÓLO al conectar una tienda o al pedir una
 * resincronización a mano. Un producto agregado después quedaba con el título y
 * el precio y nada más —el agente contestando en blanco sobre lo más nuevo del
 * catálogo, que suele ser lo que más se pregunta— y una publicación nueva en un
 * marketplace no se proponía nunca para unificar.
 *
 * Corre de noche y por tandas: leer una página con Firecrawl tarda segundos y
 * el research cuesta tokens, así que se toman pocos por cuenta y la próxima
 * corrida sigue por donde quedó. `pendientes` dice cuántos faltan.
 *
 * Auth: cabecera `x-cron-secret` contra `AUTOMATION_CRON_SECRET`.
 */
const POR_CUENTA = 10;

async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const admin = supabaseAdmin();

  // Sólo las cuentas que tienen algo pendiente: recorrer todas para no hacer
  // nada es la forma de que la corrida tarde y no se note que no sirve.
  const { data: pendientes } = await admin
    .from('shopify_products')
    .select('workspace_id')
    .not('workspace_id', 'is', null)
    .or('ai_research_status.is.null,ai_research_status.eq.idle,ai_research_status.eq.failed')
    .limit(2000);

  const cuentas = [
    ...new Set(
      ((pendientes ?? []) as Array<{ workspace_id: string }>).map((p) => p.workspace_id),
    ),
  ];

  let enriquecidos = 0;
  let unidos = 0;
  for (const workspaceId of cuentas) {
    try {
      const r = await enrichProducts(admin, { workspaceId, max: POR_CUENTA, locale: 'es' });
      enriquecidos += r.enriched;
    } catch {
      /* una cuenta que falla no puede llevarse la corrida entera */
    }
    try {
      const u = await unificarLoObvio(admin, workspaceId);
      unidos += u.unidos;
    } catch {
      /* idem */
    }
  }

  return NextResponse.json({
    ok: true,
    cuentas: cuentas.length,
    enriquecidos,
    unidos,
    pendientes: (pendientes ?? []).length,
  });
}

export const GET = withCronRun('catalog-enrich', cronHandler);
