import { adminGet, intParam } from '@/lib/admin/route';
import { listLlaves } from '@/lib/admin/llaves';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/audit/llaves — quién puede operar una cuenta desde afuera.
 *
 * Vive bajo `audit` porque contesta la otra mitad de la misma pregunta: la
 * pestaña Agente muestra lo que el MCP HIZO, y esto muestra qué llaves están
 * habilitadas a hacerlo. Una llave que nadie usó todavía no deja ni una fila de
 * auditoría, y es justo la que hay que encontrar.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = intParam(url, 'limit', 200, 500);

  return adminGet(request, { action: 'view.keys' }, async () => ({
    rows: await listLlaves(limit),
  }));
}
