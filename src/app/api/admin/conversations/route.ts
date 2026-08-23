import { adminGet, intParam } from '@/lib/admin/route';
import { listConversations } from '@/lib/admin/conversations';

export const dynamic = 'force-dynamic';

/**
 * Todas las conversaciones de la plataforma, por comercio. Sólo lectura y sólo
 * metadatos: qué canal, quién la tiene, si la IA está prendida ahí, cuántos
 * mensajes lleva y cuándo fue el último.
 *
 * Ni una palabra de lo que se dijeron. El cuerpo de un mensaje y el nombre o el
 * teléfono del comprador son datos de los clientes DE un comercio, que nunca
 * aceptaron nada con Riverz.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get('workspace') ?? undefined;
  const channel = url.searchParams.get('channel') ?? undefined;
  const status = url.searchParams.get('status') ?? undefined;
  const limit = intParam(url, 'limit', 100, 300);
  const offset = intParam(url, 'offset', 0, 100_000);

  return adminGet(
    request,
    { action: 'view.conversations', meta: { workspaceId, channel, status } },
    () => listConversations({ workspaceId, channel, status, limit, offset }),
  );
}
