import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { verifyWidgetKey, mintSession } from '@/lib/channels/webchat/token';
import { originAllowed, normalizeOrigin, widgetSettings } from '@/lib/channels/webchat/config';
import { checkIpLimit, loadWebchat } from '@/lib/channels/webchat/guard';

/**
 * POST /api/widget/session — abrir el chat en la tienda del comercio.
 *
 * Es el ÚNICO endpoint del widget que se llama desde otro dominio, y por eso
 * el único que necesita CORS. La razón no es de comodidad: el `Origin` de este
 * request es el de la tienda —el cargador lo hace desde la página del
 * comercio— y es la única oportunidad de comprobar contra qué dominio se está
 * usando la llave. Todo lo que viene después ocurre dentro del iframe, que
 * corre en nuestro propio origen y cuyo `Origin` ya no dice nada.
 *
 * De acá sale un token de sesión firmado que ata workspace, visitante y origen
 * validado. Ese token es el que manda en el resto de las rutas.
 */

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    // El navegador cachea la respuesta por origen: sin esto, la de una tienda
    // se le sirve a la siguiente y el permiso queda cruzado.
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin') ?? '';
  // El preflight no puede consultar la lista de dominios sin saber de qué
  // comercio hablamos (la llave viaja en el cuerpo, que acá no existe). Se
  // responde permisivo y el POST hace la comprobación real: un preflight
  // aprobado no entrega ningún dato.
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin || '*') });
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin') ?? '';
  const cors = corsHeaders(origin || '*');
  const deny = (status: number, error: string) =>
    NextResponse.json({ error }, { status, headers: cors });

  const limited = await checkIpLimit(request, 'session');
  if (limited) {
    for (const [k, v] of Object.entries(cors)) limited.headers.set(k, v);
    return limited;
  }

  const body = (await request.json().catch(() => null)) as {
    k?: string;
    visitorId?: string;
    page?: { url?: string; title?: string };
    locale?: string;
  } | null;
  if (!body?.k) return deny(400, 'bad_request');

  const workspaceId = verifyWidgetKey(body.k.trim());
  if (!workspaceId) return deny(404, 'not_found');

  const guard = await loadWebchat(request, workspaceId);
  if (!guard.ok) {
    for (const [k, v] of Object.entries(cors)) guard.response.headers.set(k, v);
    return guard.response;
  }
  const { config } = guard.ctx;

  // El corte de verdad: la llave está a la vista en el HTML de la tienda, así
  // que lo único que impide usarla en otro sitio es esta lista.
  if (!originAllowed(origin, config.allowed_domains)) {
    return deny(403, 'origin_not_allowed');
  }

  // El id del visitante lo guarda el navegador en el dominio de la TIENDA, no
  // en el del iframe: Safari particiona el almacenamiento de terceros y ahí el
  // hilo se perdía en cada recarga. Llega por el cuerpo, y se acepta sólo con
  // la forma que emitimos — es un identificador que termina siendo el
  // `external_id` del contacto, y no puede ser texto libre de un desconocido.
  const proposed = (body.visitorId ?? '').trim();
  const visitorId = /^wv_[0-9a-f-]{36}$/.test(proposed) ? proposed : `wv_${randomUUID()}`;

  const sessionToken = mintSession({
    workspaceId,
    visitorId,
    origin: normalizeOrigin(origin),
  });

  const { data: workspace } = await supabaseAdmin()
    .from('workspaces')
    .select('name')
    .eq('id', workspaceId)
    .maybeSingle();

  return NextResponse.json(
    {
      sessionToken,
      visitorId,
      settings: widgetSettings(config, (workspace as { name?: string } | null)?.name ?? 'Riverz'),
    },
    { headers: cors },
  );
}
