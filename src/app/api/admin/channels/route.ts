import { adminGet } from '@/lib/admin/route';
import { listChannels } from '@/lib/admin/queries';

export const dynamic = 'force-dynamic';

/** Salud de todas las conexiones de canal de la plataforma. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const channel = url.searchParams.get('channel') ?? undefined;
  const status = url.searchParams.get('status') ?? undefined;

  return adminGet(
    request,
    { action: 'view.channels', meta: { channel: channel ?? null, status: status ?? null } },
    async () => ({ rows: await listChannels({ channel, status }) }),
  );
}
