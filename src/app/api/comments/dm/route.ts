import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { CommentDmError, sendCommentDm } from '@/lib/comments/dm-writer';

/**
 * POST /api/comments/dm — escribirle al privado a quien comentó.
 *
 * Body: { message_id, text }. `message_id` es la burbuja del comentario en la
 * bandeja; de ahí salen la cuenta, el contacto y el id del comentario.
 *
 * La puerta HTTP y nada más: quién es, si es de esta cuenta y qué código
 * devolver. El envío y el registro viven en `lib/comments/dm-writer.ts`, que
 * también usa cualquier otro camino que quiera escribir al privado.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.unauthorized') },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    message_id?: string;
    text?: string;
  } | null;
  if (!body?.message_id || !body.text?.trim()) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.sendMissingFields') },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();

  // El comentario pertenece a una conversación de una cuenta: quien escribe
  // tiene que ser miembro de ESA cuenta, no de una cualquiera.
  const { data: msg } = await admin
    .from('messages')
    .select('id, conversation_id')
    .eq('id', body.message_id)
    .maybeSingle();
  const conversationId = (msg as { conversation_id?: string } | null)
    ?.conversation_id;
  if (!conversationId) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.conversationNotFound') },
      { status: 404 },
    );
  }
  const { data: conv } = await admin
    .from('conversations')
    .select('workspace_id')
    .eq('id', conversationId)
    .maybeSingle();
  const workspaceId = (conv as { workspace_id?: string } | null)?.workspace_id;
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.conversationNotFound') },
      { status: 404 },
    );
  }
  const { data: membership } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.forbidden') },
      { status: 403 },
    );
  }

  try {
    const result = await sendCommentDm(admin, {
      messageId: body.message_id,
      text: body.text,
    });
    return NextResponse.json({
      conversation_id: result.conversationId,
      via: result.via,
    });
  } catch (err) {
    // El adapter ya traduce los errores de Meta a algo que el comercio entiende
    // (ventana cerrada, permiso sin aprobar): se pasa tal cual.
    const message =
      err instanceof CommentDmError
        ? translate(locale, `errInbox.${err.message}`)
        : err instanceof Error
          ? err.message
          : translate(locale, 'errInbox.sendFailed');
    console.error('[comments/dm] no se pudo escribir al privado:', err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
