import { NextResponse } from 'next/server';
import { componerBorrador } from '@/lib/ai/borrador';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { aiBudgetGuard } from '@/lib/ai/rate-limit';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import type { Conversation } from '@/types';

/**
 * Generar la respuesta con el agente, para que la mande una persona.
 *
 * POST /api/ai/draft-reply
 *   body: { conversation_id: string }
 *   → { text: string }
 *
 * El botón hermano del de mejorar redacción: aquel reescribe lo que la
 * persona ya tipeó; este propone qué contestar leyendo la conversación
 * completa y lo que el agente sabe del producto. No envía nada — el texto
 * cae en el cuadro de escritura y quien atiende decide.
 */
export async function POST(request: Request): Promise<Response> {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.unauthorized') },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    conversation_id?: string;
  } | null;
  const conversationId = body?.conversation_id;
  if (!conversationId) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.notFound') },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  const { data: convRow } = await admin
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .is('deleted_at', null)
    .maybeSingle();
  const conversation = (convRow as Conversation | null) ?? null;
  if (!conversation) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.notFound') },
      { status: 404 },
    );
  }

  const { data: membership } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', conversation.workspace_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.forbidden') },
      { status: 403 },
    );
  }

  const overBudget = await aiBudgetGuard(conversation.workspace_id);
  if (overBudget) return overBudget;

  const { text, error } = await componerBorrador(admin, {
    workspaceId: conversation.workspace_id,
    conversation,
  });
  if (text) return NextResponse.json({ text });

  // Falta de clave es lo unico que el comercio puede arreglar solo; el resto
  // es un fallo nuestro y va como tal.
  const key = error === 'sin_clave' ? 'errAi.draftNoKey' : 'errAi.draftFailed';
  return NextResponse.json(
    { error: translate(locale, key) },
    { status: error === 'sin_clave' ? 409 : 502 },
  );
}
