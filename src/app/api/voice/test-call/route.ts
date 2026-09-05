import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { enqueueCall } from '@/lib/voice/queue';
import { isValidE164, normalizeForDialing } from '@/lib/whatsapp/phone-utils';

/**
 * POST /api/voice/test-call  { workspace_id, agent_id, phone, objective? }
 *
 * Llamada de PRUEBA a un número suelto, para escuchar al agente sin tener que
 * fabricar un contacto a mano. Reusa el contacto si el número ya está en la
 * base (no duplica la agenda del comercio) y si no crea uno marcado como
 * prueba. De ahí en adelante es una llamada normal: pasa por `enqueueCall`, o
 * sea por los mismos controles (kill switch, opt-out, tope de minutos).
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    workspace_id?: string;
    agent_id?: string;
    phone?: string;
    objective?: string;
  } | null;
  if (!body?.workspace_id || !body.agent_id || !body.phone) {
    return NextResponse.json(
      { error: 'workspace_id, agent_id and phone required' },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();
  const { data: member } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', body.workspace_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // País del propio número del comercio, para poder marcar un número escrito en
  // formato local (0111556…) igual que lo haría una llamada real.
  const { data: conn } = await admin
    .from('channel_connections')
    .select('config')
    .eq('workspace_id', body.workspace_id)
    .eq('channel', 'voice')
    .maybeSingle();
  const country =
    (conn as { config?: { country?: string } } | null)?.config?.country ?? null;
  const phone = normalizeForDialing(body.phone, country) || body.phone.trim();
  // No crear un contacto basura para recién después descubrir en `enqueueCall`
  // que el número no se puede marcar.
  if (!isValidE164(phone)) {
    return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });
  }

  try {
    // Reusar el contacto existente antes de crear: llamar a un cliente real
    // desde el botón de prueba no debe ensuciarle la agenda con un duplicado.
    const { data: found } = await admin
      .from('contacts')
      .select('id')
      .eq('workspace_id', body.workspace_id)
      .eq('phone', phone)
      .limit(1)
      .maybeSingle();

    let contactId = (found as { id: string } | null)?.id ?? null;
    if (!contactId) {
      const { data: created, error } = await admin
        .from('contacts')
        .insert({
          workspace_id: body.workspace_id,
          channel: 'voice',
          external_id: phone,
          phone,
          name: null,
        })
        .select('id')
        .single();
      if (error || !created)
        return serverError(error, 'test call: contact failed');
      contactId = (created as { id: string }).id;
    }

    const result = await enqueueCall({
      workspaceId: body.workspace_id,
      agentId: body.agent_id,
      contactId,
      callType: 'manual',
      phone,
      immediate: true, // una prueba se hace ahora, no dentro del horario de llamadas
      maxAttempts: 1, // sin reintentos: si no atienden, se prueba de nuevo a mano
      context: body.objective?.trim()
        ? { objective_override: body.objective.trim(), test_call: true }
        : { test_call: true },
      origin: 'test',
      recordSkip: true,
    });
    if (!result.enqueued) {
      return NextResponse.json({ error: result.reason }, { status: 409 });
    }
    return NextResponse.json(
      { ok: true, call_id: result.callId, phone },
      { status: 201 }
    );
  } catch (err) {
    return serverError(err, 'test call failed');
  }
}
