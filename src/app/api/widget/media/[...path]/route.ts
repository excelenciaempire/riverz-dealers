import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import {
  INBOX_SIGNED_TTL_SECONDS,
  signMediaPath,
  storagePathFromSegments,
} from '@/lib/channels/media-url';
import { requireSession } from '@/lib/channels/webchat/guard';

/**
 * GET /api/widget/media/<workspace_id>/<conversation_id>/<archivo>
 *
 * La misma puerta que `/api/media`, pero para quien no tiene sesión de Riverz:
 * el visitante del chat. El bucket es privado (migración 141), así que sin esto
 * la foto que le manda el comercio le llega como una burbuja rota.
 *
 * Autoriza con el token del widget y, sobre todo, **acota a SU conversación**:
 * la ruta nombra el workspace y la conversación, y las dos tienen que coincidir
 * con lo que dice el token firmado. Sin el segundo chequeo, un visitante podría
 * pedir los adjuntos de cualquier otra conversación del mismo comercio con sólo
 * cambiar un id en la URL — y ahí viajan comprobantes de pago y documentos.
 *
 * 404 en todos los casos que no autorizan: quien prueba ids a mano no debe
 * poder distinguir "no existe" de "existe y no es tuyo".
 */
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  // El token va por `?t=` porque un `<img>` no manda cabeceras: exigiendo la
  // cabecera, cada foto que mandaba el comercio se veía como una burbuja rota.
  const guard = await requireSession(req, 'poll', { tokenEnQuery: true });
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const { path } = await context.params;
  if (!path || path.length < 3) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Antes de comparar nada: si la ruta no es un nombre de archivo nuestro, los
  // dos primeros segmentos dejan de ser la autorización que esto cree que es.
  const storagePath = storagePathFromSegments(path);
  if (!storagePath) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const [workspaceId, duenio] = path;
  if (workspaceId !== session.workspaceId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // El segundo segmento dice de quién es el archivo, y hay dos formas:
  //
  //   - Lo que subió el VISITANTE va bajo su propio id, que sale del token
  //     firmado. Se autoriza solo, sin tocar la base.
  //   - Lo que mandó el comercio va bajo el id de la CONVERSACIÓN, y hay que
  //     comprobar que sea la de este visitante. Sin ese chequeo, cambiar un id
  //     en la URL abriría los adjuntos de cualquier otra conversación del mismo
  //     comercio — y por ahí viajan comprobantes de pago y documentos.
  if (duenio !== session.visitorId) {
    if (!/^[0-9a-f-]{36}$/i.test(duenio)) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const { data: propia } = await supabaseAdmin()
      .from('conversations')
      .select('id, contacts!inner(external_id, channel)')
      .eq('id', duenio)
      .eq('workspace_id', session.workspaceId)
      .eq('contacts.channel', 'webchat')
      .eq('contacts.external_id', session.visitorId)
      .maybeSingle();
    if (!propia) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
  }

  const signed = await signMediaPath(storagePath, INBOX_SIGNED_TTL_SECONDS);
  if (!signed) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.redirect(signed, {
    status: 302,
    headers: { 'Cache-Control': `private, max-age=${INBOX_SIGNED_TTL_SECONDS - 60}` },
  });
}
