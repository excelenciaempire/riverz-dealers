import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { ingestRawMedia } from '@/lib/channels/media-ingest';
import { ingestInboundEvent } from '@/lib/channels/inbox-writer';
import { requireSession } from '@/lib/channels/webchat/guard';
import { getLogger } from '@/lib/log/logger';

const log = getLogger('widget.upload');

/**
 * POST /api/widget/upload  (multipart/form-data)
 *
 * El visitante manda una foto. Es la mitad que faltaba del soporte real: la
 * captura del error, el comprobante de la transferencia, la foto del paquete
 * que llegó roto. Sin esto había que pedirle que lo cuente con palabras.
 *
 * Sube y ADEMÁS ingresa el mensaje, en un solo viaje. Separarlo en dos —como
 * hace la bandeja, que sube y después envía— dejaría archivos huérfanos cada
 * vez que alguien cierre la pestaña entre un paso y el otro, y acá la pestaña
 * la cierra cualquiera.
 *
 * El archivo se guarda bajo el id del VISITANTE, no bajo el de la conversación:
 * ese id sale del token firmado, así que la ruta se autoriza sola y no hace
 * falta que la conversación exista antes de subir (quien manda una foto como
 * primer mensaje es un caso normal).
 *
 * Campos: file (Blob), caption (opcional), clientMessageId.
 */

/** Tope del widget. Menos que el de la bandeja (25 MB) a propósito: esto es
 *  una puerta abierta a Internet y una foto de teléfono no llega a 10. */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Lo que un cliente necesita mandar de verdad: una foto o un comprobante.
 *
 * Video y audio quedan fuera por ahora — pesan, tardan, y en un chat de tienda
 * casi nunca son la forma de explicar un problema. Abrir el tipo es una línea
 * el día que haga falta; cerrarlo después, no.
 */
const TIPOS = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/i;

export async function POST(request: Request) {
  const guard = await requireSession(request, 'send');
  if (!guard.ok) return guard.response;
  const { session, ctx } = guard;

  // El tope se mira ANTES de parsear. Con un archivo grande el runtime corta el
  // cuerpo y `formData()` tira, así que la comprobación de más abajo no llegaba
  // a correr nunca: quien mandaba una foto de 12 MB recibía `bad_request`, que
  // no dice qué hacer, en vez de "es muy pesada". El margen cubre las cabeceras
  // del multipart, que no son el archivo.
  const declarado = Number(request.headers.get('content-length') ?? 0);
  const declaradoValido = Number.isFinite(declarado) && declarado > 0;
  if (declaradoValido && declarado > MAX_BYTES + 8 * 1024) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // Justo en el borde el corte lo hace el runtime y no llegamos a medir el
    // archivo. Si lo declarado ya rozaba el tope, la causa es el tamaño: decir
    // "petición inválida" mandaría a buscar el problema donde no está.
    return declaradoValido && declarado >= MAX_BYTES
      ? NextResponse.json({ error: 'too_large' }, { status: 413 })
      : NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const file = form.get('file');
  const clientMessageId = String(form.get('clientMessageId') ?? '').trim().slice(0, 64);
  const caption = String(form.get('caption') ?? '').trim().slice(0, 1000);
  if (!(file instanceof Blob) || !clientMessageId) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 });
  }
  if (!TIPOS.test(file.type || '')) {
    return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });
  }

  const nombre = 'name' in file ? String((file as File).name || '') : '';
  const buffer = Buffer.from(await file.arrayBuffer());

  // El tipo lo declara el navegador y puede mentir. `ingestRawMedia` mira los
  // bytes y resuelve el mime real, así que un ejecutable renombrado a .jpg se
  // guarda por lo que es y el widget lo trata como archivo, no como imagen.
  const subido = await ingestRawMedia({
    buffer,
    mime: file.type || 'application/octet-stream',
    workspaceId: session.workspaceId,
    conversationId: session.visitorId,
    id: randomUUID(),
    fileName: nombre || undefined,
  });
  if (!subido) {
    return NextResponse.json({ error: 'upload_failed' }, { status: 502 });
  }

  try {
    const result = await ingestInboundEvent(supabaseAdmin(), {
      channel: 'webchat',
      connection: ctx.connection,
      externalContactId: session.visitorId,
      externalMessageId: `wc_${clientMessageId}`,
      text: caption,
      attachments: [
        {
          url: subido.url,
          mime_type: subido.mediaMime,
          name: subido.fileName,
          size: subido.mediaSize,
        },
      ],
      receivedAt: new Date().toISOString(),
    });
    return NextResponse.json({
      ok: true,
      message_id: result?.message.id ?? null,
      conversation_id: result?.conversation.id ?? null,
    });
  } catch (err) {
    log.captureException(err, { workspaceId: session.workspaceId });
    return NextResponse.json({ error: 'ingest_failed' }, { status: 502 });
  }
}
