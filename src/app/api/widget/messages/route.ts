import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { ingestInboundEvent } from '@/lib/channels/inbox-writer';
import { requireSession } from '@/lib/channels/webchat/guard';
import { getLogger } from '@/lib/log/logger';

const log = getLogger('widget.messages');

/** Tope de un mensaje del visitante. Generoso para quien pega el detalle de su
 *  pedido, corto para que nadie use el chat como depósito. */
const MAX_TEXT = 4000;
const PAGE_SIZE = 50;

interface WireMessage {
  id: string;
  sender: 'visitor' | 'agent' | 'bot';
  text: string;
  created_at: string;
  agent_name?: string;
  /** Adjunto: la URL ya reescrita a la puerta que el visitante puede abrir. */
  media?: { url: string; kind: 'image' | 'video' | 'audio' | 'file'; name?: string };
}

/**
 * De qué tipo es el adjunto, para saber si se pinta o se ofrece para bajar.
 * Se mira el mime y no la extensión: es lo que guardan los canales.
 */
type MediaKind = 'image' | 'video' | 'audio' | 'file';

function mediaKind(mime: string | null, tipo: string | null): MediaKind {
  const m = (mime ?? '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  const t = (tipo ?? '').toLowerCase();
  if (t === 'image' || t === 'video' || t === 'audio') return t as MediaKind;
  return 'file';
}

/**
 * La URL del adjunto, apuntada a la puerta del widget.
 *
 * En la base se guarda `/api/media/...`, que exige sesión de Riverz y para el
 * visitante siempre da 401. Se reescribe al equivalente público-pero-acotado,
 * que autoriza con el token del chat y sólo sirve adjuntos de SU conversación.
 * Cualquier otra URL (una CDN de Shopify) se devuelve tal cual.
 *
 * El token viaja en la URL porque el destino de ésta es un `<img src>`, y un
 * `<img>` no manda cabeceras. Sin esto, cada foto que mandaba el comercio —y la
 * que el propio visitante acababa de subir— respondía 401 y se veía como un
 * cuadro roto, con el enlace de reserva devolviendo `session_expired`.
 */
function widgetMediaUrl(url: string | null, token: string): string | null {
  if (!url) return null;
  const at = url.indexOf('/api/media/');
  if (at === -1) return url;
  const ruta = url.slice(at + '/api/media/'.length);
  return `/api/widget/media/${ruta}?t=${encodeURIComponent(token)}`;
}

/**
 * El cursor del sondeo. Va `(created_at, id)` y no sólo la fecha porque dos
 * mensajes del mismo segundo son normales —el agente parte su respuesta en
 * varias burbujas— y con la fecha sola el segundo se pierde para siempre.
 * Opaco a propósito: el día que esto sea un stream y no un sondeo, el cliente
 * no se entera.
 */
function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string | null): { at: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    // Se comprueba la FORMA, no sólo que haya dos partes: estos dos valores se
    // interpolan en un filtro de PostgREST, y el cursor lo elige quien llama.
    // Con un cursor fabricado se podían inyectar expresiones de filtro; el
    // recorte por conversación va aparte y aguanta, pero rompía el parseo y
    // dejaba el sondeo en 502 — o sea, el chat mudo.
    if (!at || !id) return null;
    if (!/^[0-9T:.+\-\s]{10,40}$/.test(at)) return null;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { at, id };
  } catch {
    return null;
  }
}

/** La conversación de chat web de este visitante, si ya escribió alguna vez. */
async function findConversation(
  workspaceId: string,
  visitorId: string,
): Promise<{ id: string; status: string } | null> {
  const admin = supabaseAdmin();
  const { data: contact } = await admin
    .from('contacts')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'webchat')
    .eq('external_id', visitorId)
    .maybeSingle();
  if (!contact) return null;

  const { data } = await admin
    .from('conversations')
    .select('id, status')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', (contact as { id: string }).id)
    .eq('channel', 'webchat')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string; status: string } | null) ?? null;
}

/**
 * POST /api/widget/messages — el visitante escribió.
 *
 * No hace nada especial con el mensaje: lo mete por la misma puerta que usan
 * WhatsApp, Instagram y el correo (`ingestInboundEvent`). De ahí sale gratis
 * todo lo que ya existe — el contacto, la conversación en la bandeja, los
 * flujos, las automatizaciones y el agente de IA con su conocimiento completo:
 * la web del comercio, el research de cada producto, el catálogo y las
 * herramientas para consultar un pedido o armar un checkout.
 *
 * La respuesta del agente NO viaja en esta respuesta HTTP: se escribe como un
 * mensaje más y el widget la recoge sondeando. Así el mensaje que escribe una
 * persona desde la bandeja llega por exactamente el mismo camino.
 */
export async function POST(request: Request) {
  const guard = await requireSession(request, 'send');
  if (!guard.ok) return guard.response;
  const { session, ctx } = guard;

  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    clientMessageId?: unknown;
  } | null;

  // Se comprueba el TIPO, no sólo el valor. El cuerpo lo arma un cliente que
  // no controlamos —y cualquiera puede llamar a esto a mano—, así que un
  // `text` que llega como número o como lista no tiene `.trim()` y hacía
  // reventar la ruta con un 500 mudo en vez de un 400 que dice qué pasó.
  if (typeof body?.text !== 'string' || typeof body?.clientMessageId !== 'string') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const text = body.text.trim();
  if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 });
  if (text.length > MAX_TEXT) {
    return NextResponse.json({ error: 'too_long' }, { status: 413 });
  }

  // El id lo pone el cliente para que un reintento tras un corte de red no
  // duplique el mensaje: `ingestInboundEvent` descarta por id externo repetido.
  const clientMessageId = body.clientMessageId.trim().slice(0, 64);
  if (!clientMessageId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  try {
    const result = await ingestInboundEvent(supabaseAdmin(), {
      channel: 'webchat',
      connection: ctx.connection,
      externalContactId: session.visitorId,
      externalMessageId: `wc_${clientMessageId}`,
      text,
      receivedAt: new Date().toISOString(),
    });
    if (!result) {
      // Repetido: el mensaje ya está guardado. Para el widget es un éxito —
      // reintentó y llegó igual.
      const conversation = await findConversation(session.workspaceId, session.visitorId);
      return NextResponse.json({ ok: true, conversation_id: conversation?.id ?? null });
    }
    return NextResponse.json({
      ok: true,
      message_id: result.message.id,
      conversation_id: result.conversation.id,
    });
  } catch (err) {
    log.captureException(err, { workspaceId: session.workspaceId });
    return NextResponse.json({ error: 'ingest_failed' }, { status: 502 });
  }
}

/**
 * GET /api/widget/messages?after=<cursor> — qué hay de nuevo.
 *
 * Sin cursor devuelve el final del historial, que es lo que ve quien vuelve a
 * abrir el chat al día siguiente. Con cursor, sólo lo posterior.
 *
 * Es un sondeo y no una conexión abierta porque el visitante es anónimo: el
 * tiempo real de Supabase filtra por membresía del comercio, así que no hay
 * forma de suscribirlo sin abrirle la base a cualquiera. La bandeja del
 * comercio, que sí tiene sesión, se sigue actualizando sola.
 */
export async function GET(request: Request) {
  const guard = await requireSession(request, 'poll');
  if (!guard.ok) return guard.response;
  const { session } = guard;

  // El mismo token que trae la petición se le pega a la URL de cada adjunto:
  // el `<img>` que la va a pedir no puede mandar la cabecera.
  const tokenDelChat = (request.headers.get('authorization') ?? '')
    .replace(/^bearer\s+/i, '')
    .trim();

  const url = new URL(request.url);
  const cursor = decodeCursor(url.searchParams.get('after'));

  const conversation = await findConversation(session.workspaceId, session.visitorId);
  if (!conversation) {
    return NextResponse.json({ messages: [], cursor: null, status: 'open' });
  }

  const admin = supabaseAdmin();
  let query = admin
    .from('messages')
    .select(
      'id, sender_type, content_text, created_at, origin_name, status, media_url, media_type, media_mime, attachments',
    )
    .eq('conversation_id', conversation.id);

  if (cursor) {
    query = query
      .or(`created_at.gt.${cursor.at},and(created_at.eq.${cursor.at},id.gt.${cursor.id})`)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);
  } else {
    // La primera carga trae el FINAL del hilo, así que se pide al revés y se
    // da vuelta: pedirlo ascendente devolvería el principio de una
    // conversación larga y el chat abriría en el pasado.
    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE);
  }

  const { data, error } = await query;
  if (error) {
    log.captureException(error, { workspaceId: session.workspaceId });
    return NextResponse.json({ error: 'read_failed' }, { status: 502 });
  }

  const rows = (data ?? []) as Array<{
    id: string;
    sender_type: string;
    content_text: string | null;
    created_at: string;
    origin_name: string | null;
    status: string | null;
    media_url: string | null;
    media_type: string | null;
    media_mime: string | null;
    attachments: Array<{ url?: string; mime_type?: string; name?: string }> | null;
  }>;
  const ordered = cursor ? rows : [...rows].reverse();

  const messages: WireMessage[] = ordered
    // Un envío fallido no se le muestra a quien nunca lo recibió: la burbuja
    // roja es para la bandeja del comercio, no para el cliente.
    .filter((m) => m.status !== 'failed')
    // Un mensaje que es SÓLO un archivo llega con el texto vacío, y filtrarlo
    // por texto lo hacía desaparecer: la foto que mandó el comercio no llegaba
    // nunca y del otro lado no pasaba nada.
    .filter((m) => (m.content_text ?? '').trim().length > 0 || Boolean(m.media_url ?? m.attachments?.[0]?.url))
    .map((m) => {
      const adjunto = m.attachments?.[0];
      const url = widgetMediaUrl(m.media_url ?? adjunto?.url ?? null, tokenDelChat);
      return {
        id: m.id,
        sender: (m.sender_type === 'customer'
          ? 'visitor'
          : m.sender_type === 'bot'
            ? 'bot'
            : 'agent') as WireMessage['sender'],
        text: m.content_text ?? '',
        created_at: m.created_at,
        ...(m.sender_type === 'agent' && m.origin_name ? { agent_name: m.origin_name } : {}),
        ...(url
          ? {
              media: {
                url,
                kind: mediaKind(m.media_mime ?? adjunto?.mime_type ?? null, m.media_type),
                ...(adjunto?.name ? { name: adjunto.name } : {}),
              },
            }
          : {}),
      };
    });

  const last = ordered[ordered.length - 1];
  return NextResponse.json({
    messages,
    cursor: last ? encodeCursor(last.created_at, last.id) : (url.searchParams.get('after') ?? null),
    status: conversation.status,
  });
}
