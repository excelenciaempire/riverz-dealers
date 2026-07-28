import { adminGet, intParam } from '@/lib/admin/route';
import { listAudit } from '@/lib/admin/queries';

export const dynamic = 'force-dynamic';

/** Registro de lo que el equipo hizo (y miró) en el panel. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const actor = url.searchParams.get('actor') ?? undefined;
  const limit = intParam(url, 'limit', 100, 500);
  const offset = intParam(url, 'offset', 0, 100_000);

  return adminGet(
    request,
    { action: 'view.audit', meta: { actor: actor ?? null } },
    async () => {
      const rows = await listAudit({ actor, limit, offset });
      return { rows, hasMore: rows.length === limit };
    },
  );
}
