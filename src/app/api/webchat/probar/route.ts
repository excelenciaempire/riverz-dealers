import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { getWebchatConnection, webchatConfig } from '@/lib/channels/webchat/connection-store';
import { mintSession } from '@/lib/channels/webchat/token';
import { normalizeOrigin } from '@/lib/channels/webchat/config';
import { publicBaseUrl } from '@/lib/base-url';

/**
 * POST /api/webchat/probar — abrir el chat de verdad, desde el panel.
 *
 * La vista previa dibuja cómo queda; esto deja escribirle. Es el mismo chat
 * que se sirve en la tienda —mismo iframe, mismas rutas, mismo agente— así que
 * lo que se prueba acá es lo que va a pasar allá: el conocimiento, las
 * herramientas, el tono y el tiempo que tarda en contestar. Un guion propio
 * para el panel probaría el guion, no el producto.
 *
 * Lo único distinto es de dónde sale el permiso. El widget de la tienda abre
 * sesión con la llave de instalación y el `Origin` del comercio; acá el origen
 * es el nuestro, que nunca va a estar en su lista de dominios. Por eso este
 * token se marca como de prueba (`pr`) y lo emite una ruta del panel, con
 * sesión, CSRF y membresía: el permiso viene de quién sos, no de dónde estás.
 *
 * La conversación es real y entra a la bandeja. Es a propósito: probar sin
 * dejar rastro obliga a mantener un camino paralelo que nadie mira, y el
 * comercio quiere ver la respuesta en el mismo lugar donde va a verlas todas.
 */

/**
 * El visitante de prueba de esta persona.
 *
 * Derivado y estable: quien vuelve a probar mañana sigue en el mismo hilo, y
 * dos personas del mismo comercio no se pisan la conversación. No hay fila que
 * crear —el contacto lo crea el primer mensaje, como el de cualquier
 * visitante— y el id tiene la forma que el resto del chat web exige.
 */
function visitanteDePrueba(workspaceId: string, userId: string): string {
  const h = createHash('sha256').update(`webchat-prueba:${workspaceId}:${userId}`).digest('hex');
  return `wv_${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Dos horas: alcanza para una prueba y no deja un token vivo todo el día. */
const TTL_MS = 2 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const workspaceId = await resolveWorkspaceIdForUser(supabaseAdmin(), user.id);
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 404 });

  // El chat apagado no se puede probar: las rutas del widget responden 404 a
  // todo, y el visitante vería un chat mudo sin saber por qué. Se dice acá.
  const connection = await getWebchatConnection(workspaceId, supabaseAdmin());
  const config = webchatConfig(connection);
  if (!connection || !config.enabled) {
    return NextResponse.json({ error: 'disabled' }, { status: 409 });
  }

  const sessionToken = mintSession({
    workspaceId,
    visitorId: visitanteDePrueba(workspaceId, user.id),
    origin: normalizeOrigin(publicBaseUrl()),
    exp: Date.now() + TTL_MS,
    pr: 1,
  });

  return NextResponse.json({ sessionToken });
}
