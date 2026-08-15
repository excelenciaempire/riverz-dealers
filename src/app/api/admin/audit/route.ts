import { adminGet, intParam } from '@/lib/admin/route';
import { listAudit, listPlatformAudit } from '@/lib/admin/queries';

export const dynamic = 'force-dynamic';

/**
 * Los dos libros de actas.
 *
 * `?source=panel` (por defecto) — lo que el equipo hizo y miró en /admin.
 * `?source=agente`               — lo que el MCP hizo sobre la cuenta de un
 *                                  comercio, lecturas incluidas.
 *
 * Iban separados por accidente: el segundo se escribía desde el primer día del
 * MCP y no lo leía ninguna pantalla, aunque su propia migración dijera que sí.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const actor = url.searchParams.get('actor') ?? undefined;
  const source = url.searchParams.get('source') === 'agente' ? 'agente' : 'panel';
  const limit = intParam(url, 'limit', 100, 500);
  const offset = intParam(url, 'offset', 0, 100_000);

  return adminGet(
    request,
    { action: 'view.audit', meta: { actor: actor ?? null, source } },
    async () => {
      const rows =
        source === 'agente'
          ? await listPlatformAudit({ actor, limit, offset })
          : await listAudit({ actor, limit, offset });
      return { rows, source, hasMore: rows.length === limit };
    },
  );
}
