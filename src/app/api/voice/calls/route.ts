import { NextResponse } from 'next/server';
import type { VoiceCallType } from '@/types';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { enqueueCall } from '@/lib/voice/queue';
import { pickVoiceAgent } from '@/lib/voice/inbound';
import { escapeLike } from '@/lib/security/like';

/** Tope de filas por exportación: un CSV, no un volcado de la base. */
const EXPORT_MAX_ROWS = 5000;

/**
 * Voice calls — dashboard endpoints.
 *   POST: place a manual "call with AI" from the inbox/contact.
 *   GET:  list recent calls for a workspace (metrics + call log).
 * Session-authenticated; the caller must be a workspace member.
 */

async function requireMember(userId: string, workspaceId: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data);
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    workspace_id?: string;
    contact_id?: string;
    agent_id?: string;
    objective?: string;
    phone?: string;
    call_type?: VoiceCallType;
    conversation_id?: string;
  } | null;
  if (!body?.workspace_id || !body.contact_id) {
    return NextResponse.json({ error: 'workspace_id and contact_id required' }, { status: 400 });
  }
  if (!(await requireMember(user.id, body.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Resolve the agent: explicit, or the workspace's best voice-enabled agent.
  let agentId = body.agent_id;
  if (!agentId) {
    const agent = await pickVoiceAgent(supabaseAdmin(), body.workspace_id);
    if (!agent) {
      return NextResponse.json({ error: 'no_voice_agent' }, { status: 409 });
    }
    agentId = agent.id;
  }

  try {
    const result = await enqueueCall({
      workspaceId: body.workspace_id,
      agentId,
      contactId: body.contact_id,
      callType: body.call_type ?? 'manual',
      phone: body.phone ?? null,
      immediate: true,
      context: body.objective ? { objective_override: body.objective } : {},
      origin: 'manual',
      sourceConversationId: body.conversation_id,
      recordSkip: true,
    });
    if (!result.enqueued) {
      return NextResponse.json({ error: result.reason }, { status: 409 });
    }
    return NextResponse.json({ ok: true, call_id: result.callId, scheduled_at: result.scheduledAt }, { status: 201 });
  } catch (err) {
    return serverError(err, 'enqueue call failed');
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get('workspace_id');
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  }
  if (!(await requireMember(user.id, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  // Modo exportación: una sola tanda con TODO lo que cumple el filtro (sin
  // paginar), acotada para no traerse un workspace entero a memoria.
  const isExport = url.searchParams.get('export') === '1';
  const limit = isExport
    ? Math.min(EXPORT_MAX_ROWS, Number(url.searchParams.get('limit')) || EXPORT_MAX_ROWS)
    : Math.min(200, Number(url.searchParams.get('limit')) || 25);
  const offset = isExport ? 0 : Math.max(0, Number(url.searchParams.get('offset')) || 0);

  const admin = supabaseAdmin();
  let query = admin
    .from('voice_calls')
    .select('*, contact:contacts(id, name, phone), agent:ai_agents(id, name)', {
      count: isExport ? undefined : 'exact',
    })
    .eq('workspace_id', workspaceId);

  // --- Filtros (todos opcionales; vacío = sin filtrar) ---
  // Cada uno admite varios valores separados por coma: dentro de un filtro basta
  // con cumplir cualquiera, y entre filtros distintos las condiciones se suman.
  const anyOf = (param: string, column: string) => {
    const values = (url.searchParams.get(param) ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length === 1) query = query.eq(column, values[0]);
    else if (values.length > 1) query = query.in(column, values);
  };
  anyOf('status', 'status');
  anyOf('outcome', 'outcome');
  anyOf('direction', 'direction');
  anyOf('call_type', 'call_type');
  anyOf('agent_id', 'agent_id');

  // Rango de fechas: instantes ya resueltos en la zona horaria del workspace
  // por el cliente, así el corte del día es el mismo que en el resto del panel.
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (from && !Number.isNaN(Date.parse(from))) query = query.gte('created_at', from);
  if (to && !Number.isNaN(Date.parse(to))) query = query.lt('created_at', to);

  // Búsqueda por nombre de contacto o teléfono. El nombre vive en `contacts`,
  // así que se resuelve a ids primero: filtrar sobre la tabla embebida sólo
  // recorta el embed, no las llamadas.
  // `or()` de PostgREST separa condiciones por coma y agrupa con paréntesis:
  // esos caracteres (y las comillas) se sacan del término antes de armarlo.
  const q = url.searchParams
    .get('q')
    ?.replace(/[(),"']/g, ' ')
    .trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    const { data: matches } = await admin
      .from('contacts')
      .select('id')
      .eq('workspace_id', workspaceId)
      .or(`name.ilike.${like},phone.ilike.${like}`)
      .limit(1000);
    const ids = (matches ?? []).map((c: { id: string }) => c.id);
    query = ids.length ? query.or(`phone.ilike.${like},contact_id.in.(${ids.join(',')})`) : query.ilike('phone', like);
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return serverError(error);
  return NextResponse.json({
    calls: data ?? [],
    total: count ?? (data ?? []).length,
    truncated: isExport && (data ?? []).length >= EXPORT_MAX_ROWS,
  });
}
