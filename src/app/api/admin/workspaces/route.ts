import { adminGet, intParam } from '@/lib/admin/route';
import { listWorkspaces } from '@/lib/admin/queries';

export const dynamic = 'force-dynamic';

/** Listado de todos los comercios de la plataforma. Solo lectura. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const search = url.searchParams.get('q') ?? '';
  const limit = intParam(url, 'limit', 50, 200);
  const offset = intParam(url, 'offset', 0, 100_000);

  return adminGet(
    request,
    { action: 'view.workspaces', meta: { search, limit, offset } },
    () => listWorkspaces({ search, limit, offset }),
  );
}
