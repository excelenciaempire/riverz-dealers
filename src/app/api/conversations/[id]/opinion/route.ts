import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { pedirOpinion } from '@/lib/inbox/opinion';

/**
 * POST /api/conversations/[id]/opinion — "¿te sirvió?" al cerrar.
 *
 * Existe como endpoint propio y no dentro del cambio de estado por una regla
 * que vale más que la comodidad: gestionar la bandeja no le escribe a nadie
 * (`capabilities/inbox.test.ts`). `cambiarEstadoConversacion` también la usa el
 * Operator, y un cierre en lote mandándole un mensaje a cada cliente es
 * exactamente lo que esa regla existe para impedir.
 *
 * Acá, en cambio, hay alguien que acaba de cerrar ESTA conversación a mano.
 *
 * Contesta `ok` siempre que la petición sea legítima: si el comercio no tiene
 * la encuesta encendida, o el canal no aplica, o ya se preguntó, no pasa nada y
 * eso no es un error que la bandeja tenga que mostrar.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const block = await csrfGuard(req);
  if (block) return block;
  const locale = await getLocale();
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.missingIdGeneric') },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.notSignedIn') },
      { status: 401 },
    );
  }

  const admin = supabaseAdmin();
  const { data: conv } = await admin
    .from('conversations')
    .select('id, workspace_id')
    .eq('id', id)
    .maybeSingle();
  if (!conv) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.notFound') },
      { status: 404 },
    );
  }

  const { data: membership } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', (conv as { workspace_id: string }).workspace_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.forbidden') },
      { status: 403 },
    );
  }

  const preguntada = await pedirOpinion(admin, {
    workspaceId: (conv as { workspace_id: string }).workspace_id,
    conversationId: id,
  });
  return NextResponse.json({ ok: true, preguntada });
}
