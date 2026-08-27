import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import {
  verifyWidgetKey,
  mintSession,
  visitorProof,
  visitorProofValid,
  VISITOR_ID_RE,
} from '@/lib/channels/webchat/token';
import { originAllowed, normalizeOrigin, widgetSettings } from '@/lib/channels/webchat/config';
import { agenteDelChat } from '@/lib/channels/webchat/connection-store';
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

/**
 * Con qué id sigue este visitante.
 *
 * Tres caminos, en orden: con prueba válida, el suyo; sin prueba pero con un id
 * que nadie usó todavía, ése (es el visitante que instaló el widget antes de
 * que existiera la prueba, y no hay nada que robarle); en cualquier otro caso,
 * uno nuevo. Reclamar el id de alguien que ya conversó nunca funciona.
 */
async function resolverVisitante(
  workspaceId: string,
  proposed: string,
  proof: string,
): Promise<string> {
  if (!VISITOR_ID_RE.test(proposed)) return `wv_${randomUUID()}`;
  if (visitorProofValid(workspaceId, proposed, proof)) return proposed;

  const { data } = await supabaseAdmin()
    .from('contacts')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'webchat')
    .eq('external_id', proposed)
    .maybeSingle();
  return data ? `wv_${randomUUID()}` : proposed;
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

  /**
   * Las señales de atribución, acotadas.
   *
   * Llegan desde el navegador, así que son texto de afuera: se recortan a lo
   * que Meta emite de verdad (`fb.1.<ms>.<valor>`) y se descarta cualquier otra
   * cosa. Sin esto, cualquiera podría inflar el token —que viaja en cada
   * pedido— con kilobytes de basura firmada por nosotros.
   */
  const recorte = (m: { fbp?: unknown; fbc?: unknown; url?: unknown } | undefined) => {
    if (!m) return undefined;
    const corto = (v: unknown, max: number) =>
      typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
    const out: { fbp?: string; fbc?: string; url?: string } = {};
    const fbp = corto(m.fbp, 100);
    const fbc = corto(m.fbc, 200);
    const url = corto(m.url, 300);
    if (fbp) out.fbp = fbp;
    if (fbc) out.fbc = fbc;
    if (url) out.url = url;
    return Object.keys(out).length ? out : undefined;
  };

  const body = (await request.json().catch(() => null)) as {
    k?: string;
    visitorId?: string;
    visitorProof?: string;
    page?: { url?: string; title?: string };
    locale?: string;
    marketing?: { fbp?: unknown; fbc?: unknown; url?: unknown };
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
  //
  // Pero la forma no alcanzaba. El id se publica a propósito: viaja en los
  // atributos del carrito para poder atribuir la venta, queda en el pedido y
  // cualquier script de la tienda lo lee. Aceptándolo pelado, quien lo viera
  // pedía una sesión con él y heredaba la conversación de esa persona, sus
  // comprobantes y la posibilidad de escribir en su nombre. Ahora hace falta la
  // prueba, que vive sólo en el navegador de su dueño.
  const proposed = (body.visitorId ?? '').trim();
  const visitorId = await resolverVisitante(
    workspaceId,
    proposed,
    (body.visitorProof ?? '').trim(),
  );

  const sessionToken = mintSession({
    workspaceId,
    visitorId,
    origin: normalizeOrigin(origin),
    // Las señales de atribución que el cargador leyó en la tienda. Se acotan
    // acá: son cookies de un tercero y no hay motivo para guardar más largo de
    // lo que Meta emite.
    mk: recorte(body.marketing),
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
      visitorProof: visitorProof(workspaceId, visitorId),
      settings: widgetSettings(
        config,
        (workspace as { name?: string } | null)?.name ?? 'Riverz',
        await agenteDelChat(workspaceId, config.agent_id ?? null),
      ),
    },
    { headers: cors },
  );
}
