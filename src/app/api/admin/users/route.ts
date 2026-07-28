import { adminGet, intParam } from '@/lib/admin/route';
import { listUsers } from '@/lib/admin/queries';

export const dynamic = 'force-dynamic';

/** Todos los usuarios de Riverz y los comercios a los que pertenecen. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const search = url.searchParams.get('q') ?? '';
  const limit = intParam(url, 'limit', 50, 200);
  const offset = intParam(url, 'offset', 0, 100_000);

  return adminGet(
    request,
    { action: 'view.users', meta: { search, limit, offset } },
    () => listUsers({ search, limit, offset }),
  );
}
