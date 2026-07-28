import { adminGet, intParam } from '@/lib/admin/route';
import { listWaitlist } from '@/lib/admin/queries';

export const dynamic = 'force-dynamic';

/**
 * Lista de espera del prelanzamiento. La tabla existe desde la migración 077 y
 * hasta ahora no tenía ninguna pantalla: los leads solo se veían por correo.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = intParam(url, 'limit', 100, 500);
  const offset = intParam(url, 'offset', 0, 100_000);

  return adminGet(request, { action: 'view.waitlist' }, () =>
    listWaitlist({ limit, offset }),
  );
}
