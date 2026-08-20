import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import type { Conversation } from '@/types';

/**
 * La respuesta que el asistente dejó propuesta para esta conversación.
 *
 * Sólo existe para los agentes en modo "aprobar cada mensaje" (migración 170):
 * el runner genera la respuesta y la guarda acá en vez de enviarla.
 *
 *   GET    → { draft: { id, text, agent_name, created_at } | null }
 *   DELETE → la descarta (también se llama después de enviarla)
 *
 * El envío en sí va por /api/messages/send, el mismo camino que cuando una
 * persona escribe: aprobar es mandar ese texto, no una vía aparte.
 */

interface PendingRow {
  id: string;
  content_text: string;
  agent_name: string | null;
  created_at: string;
}

/** Devuelve la conversación si el usuario es miembro de su workspace. */
async function authorize(
  request: Request,
  conversationId: string,
): Promise<
  | { ok: true; conversation: Conversation }
  | { ok: false; response: NextResponse }
> {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: translate(locale, 'errInbox.unauthorized') },
        { status: 401 },
      ),
    };
  }
  const admin = supabaseAdmin();
  const { data: conversation } = await admin
    .from('conversations')
    .select('id, workspace_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conversation) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: translate(locale, 'errInbox.conversationNotFound') },
        { status: 404 },
      ),
    };
  }
  const { data: membership } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', (conversation as Conversation).workspace_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: translate(locale, 'errInbox.forbidden') },
        { status: 403 },
      ),
    };
  }
  return { ok: true, conversation: conversation as Conversation };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const auth = await authorize(request, id);
  if (!auth.ok) return auth.response;

  const { data } = await supabaseAdmin()
    .from('ai_pending_replies')
    .select('id, content_text, agent_name, created_at')
    .eq('conversation_id', id)
    .maybeSingle();
  const row = data as PendingRow | null;
  return NextResponse.json({
    draft: row
      ? {
          id: row.id,
          text: row.content_text,
          agent_name: row.agent_name,
          created_at: row.created_at,
        }
      : null,
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id } = await params;
  const auth = await authorize(request, id);
  if (!auth.ok) return auth.response;

  await supabaseAdmin()
    .from('ai_pending_replies')
    .delete()
    .eq('conversation_id', id);
  return NextResponse.json({ ok: true });
}
