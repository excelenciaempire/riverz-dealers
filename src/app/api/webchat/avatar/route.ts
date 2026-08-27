import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { isWorkspaceAdmin, resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { getLogger } from '@/lib/log/logger';

const log = getLogger('webchat.avatar');

/**
 * POST /api/webchat/avatar  (multipart/form-data, campo `file`)
 *
 * La imagen del chat, subida desde la computadora.
 *
 * Antes el único camino era pegar una URL `https://`. Eso da por hecho que el
 * comercio ya tiene su logo publicado en algún lado y sabe copiar su dirección
 * — dos cosas que casi nunca pasan, así que la mayoría dejaba el campo vacío y
 * el chat salía a la tienda sin cara.
 *
 * Va al bucket público `avatars`, el mismo de las fotos de perfil: esta imagen
 * la tiene que poder cargar el navegador de cualquier visitante de la tienda,
 * así que una URL firmada que caduca no sirve.
 *
 * La ruta lleva el id del workspace y una marca de tiempo. Lo segundo importa:
 * sin ella, cambiar el logo dejaba la imagen vieja en la caché del navegador de
 * media tienda.
 */

const BUCKET = 'avatars';
const MAX_BYTES = 2 * 1024 * 1024;
const TIPOS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 404 });
  // Lo mismo que guardar la configuración: esta imagen se ve en la tienda.
  if (!(await isWorkspaceAdmin(admin, user.id, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // El tope se mira antes de parsear: con un archivo grande el runtime corta el
  // cuerpo y `formData()` tira, así que la comprobación de abajo no llegaría.
  const declarado = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declarado) && declarado > MAX_BYTES + 8 * 1024) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 });

  const ext = TIPOS[file.type.toLowerCase()];
  if (!ext) return NextResponse.json({ error: 'bad_type' }, { status: 415 });

  const path = `webchat/${workspaceId}/logo-${Date.now()}.${ext}`;
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: true });
  if (error) {
    log.warn('no_pude_subir', { workspaceId, error: error.message });
    return NextResponse.json({ error: 'upload_failed' }, { status: 502 });
  }

  const {
    data: { publicUrl },
  } = admin.storage.from(BUCKET).getPublicUrl(path);

  return NextResponse.json({ url: publicUrl });
}
