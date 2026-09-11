import { sembrarReglasPorDefecto } from '@/lib/ai/reglas-por-defecto';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { encrypt } from '@/lib/whatsapp/encryption';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { findChannelConflict, channelLabels } from '@/lib/ai/channel-conflict';
import { AGENT_PERMISSIONS, isAgentRole } from '@/lib/ai/roles';
import type { AgentPermissions } from '@/lib/ai/roles';

/**
 * Con qué nace un agente: pudiendo hacer todo lo que su rol permita.
 *
 * Antes nacía con `permissions` en null, que cae a las columnas viejas y deja
 * `crear_pedidos` apagado. El resultado era un agente que sabía cerrar la venta
 * y no lo hacía, por una casilla en una pestaña que casi nadie abría. Quien
 * quiera recortarle algo lo hace ahí mismo, y elegir un rol sigue aplicando su
 * preset por encima de esto.
 */
const PERMISOS_COMPLETOS: AgentPermissions = Object.fromEntries(
  AGENT_PERMISSIONS.map((p) => [p, true])
) as AgentPermissions;
import type { AiAgent } from '@/lib/ai/types';
import { validVoiceConfig } from '@/lib/voice-notes/types';
import { validVoiceAgentLink } from '@/lib/ai/agents/update';

/**
 * List + create endpoints for AI customer-service agents.
 * Workspace-scoped — the caller must be a member of the workspace.
 *
 * GET    /api/ai/agents?workspace_id=<uuid>
 * POST   /api/ai/agents          body: { workspace_id, name, ...defaults }
 */
export async function GET(request: Request) {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, 'errAi.unauthorized') },
      { status: 401 }
    );

  const workspaceId = new URL(request.url).searchParams.get('workspace_id');
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.workspaceIdRequired') },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();
  const { data: member } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member)
    return NextResponse.json(
      { error: translate(locale, 'errAi.forbidden') },
      { status: 403 }
    );

  // Incluimos ai_agent_products(product_id): el editor pre-selecciona los
  // productos asignados al abrir un agente existente. Sin esto el modal
  // arrancaba en cero y, al guardar, el PATCH borraba la asignación
  // (manda product_ids=[] con scope 'specific'). Pérdida de datos silenciosa.
  const { data, error } = await admin
    .from('ai_agents')
    .select('*, ai_agent_channels(channel), ai_agent_products(product_id)')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) return serverError(error);

  // Never leak the encrypted key.
  const safe = (data ?? []).map((a) => stripKey(a as AgentWithChannels));
  return NextResponse.json({ agents: safe });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, 'errAi.unauthorized') },
      { status: 401 }
    );

  const body = (await request.json().catch(() => null)) as
    | (Partial<AiAgent> & {
        workspace_id?: string;
        channels?: string[];
        product_ids?: string[];
        api_key?: string;
      })
    | null;
  if (!body?.workspace_id || !body.name?.trim()) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.workspaceIdNameRequired') },
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
    return NextResponse.json(
      { error: translate(locale, 'errAi.forbidden') },
      { status: 403 }
    );

  // scope='channels' sin canales = agente que no responde en ninguna parte
  // (y que el detector de conflictos ignora porque no ocupa nada). Estado
  // inservible: lo rechazamos también desde el server, no sólo en la UI.
  if (body.scope === 'channels' && (body.channels ?? []).length === 0) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.channelsRequired') },
      { status: 400 }
    );
  }

  // Un solo agente activo por canal Y ROL: si este nace activo y le disputa
  // los mensajes a otro del mismo rol, lo bloqueamos con un mensaje claro.
  // Roles distintos conviven — se reparten el canal, no se lo pelean.
  if (body.is_active) {
    const conflict = await findChannelConflict(admin, {
      workspaceId: body.workspace_id,
      agentId: null,
      scope: body.scope ?? 'workspace',
      channels: body.scope === 'channels' ? (body.channels ?? []) : [],
      role: body.role,
    });
    if (conflict) {
      return NextResponse.json(
        {
          error: translate(locale, 'errAi.channelConflict', {
            agent: conflict.agentName,
            channels: channelLabels(conflict.channels, locale),
          }),
        },
        { status: 409 }
      );
    }
  }

  if (body.voice_note != null && !validVoiceConfig(body.voice_note)) return NextResponse.json({ error: translate(locale, 'voiceNotes.invalidText') }, { status: 400 });
  const payload: Record<string, unknown> = {
    workspace_id: body.workspace_id,
    name: body.name.trim(),
    is_active: body.is_active ?? false,
    persona: body.persona ?? '',
    knowledge: body.knowledge ?? null,
    knowledge_url: body.knowledge_url ?? null,
    // Default the agent's language to the merchant's UI locale (es/en) so a
    // new English merchant gets an English-speaking agent end to end —
    // runtime replies, generated persona and auto-filled copy all follow it.
    language: body.language ?? locale,
    tone: body.tone ?? 'friendly',
    max_response_chars: body.max_response_chars ?? 500,
    reply_delay_seconds: body.reply_delay_seconds ?? 0,
    context_messages: body.context_messages ?? 100,
    response_mode: body.response_mode ?? 'dynamic',
    voice_note: body.voice_note ?? null,
    requires_approval: body.requires_approval ?? false,
    inbound_debounce_seconds: body.inbound_debounce_seconds ?? 15,
    reply_when_assigned: body.reply_when_assigned ?? false,
    reply_outside_hours: body.reply_outside_hours ?? true,
    business_hours: body.business_hours ?? null,
    escalate_keywords: body.escalate_keywords ?? [],
    escalate_after_messages: body.escalate_after_messages ?? 0,
    followup_enabled: body.followup_enabled ?? false,
    followup_delay_hours: body.followup_delay_hours ?? 24,
    followup_max_count: body.followup_max_count ?? 1,
    proactive_send_mode: body.proactive_send_mode ?? 'auto',
    // Un agente nuevo nace pudiendo atender: cerrar la venta es lo que el
    // comercio espera de él, y dejarlo apagado convertía la capacidad en una
    // casilla escondida que casi nadie encontraba. Igual no puede crear nada
    // sin una tienda conectada con permiso de escritura — ahí está el freno
    // real —, y el que prefiera que no cierre pedidos lo apaga en Avanzado.
    puede_crear_pedidos: body.puede_crear_pedidos ?? true,
    // Migración 164. Sin rol es 'general', que es como se comportan todos los
    // agentes anteriores.
    role: isAgentRole(body.role) ? body.role : 'general',
    permissions: body.permissions ?? PERMISOS_COMPLETOS,
    provider: body.provider ?? 'anthropic',
    model: body.model ?? 'claude-haiku-4-5-20251001',
    scope: body.scope ?? 'workspace',
    product_scope: body.product_scope ?? 'all',
    priority: body.priority ?? 0,
    created_by: user.id,
  };
  // Voice AI (migration 113) — only override the DB defaults when the client
  // sent a value, so agents created without touching the Voz tab keep the
  // sensible column defaults.
  for (const k of [
    'voice_enabled',
    'voice_agent_id',
    'voice_ai_decides',
    'voice_provider',
    'voice_id',
    'voice_greeting',
    'voice_system_prompt',
    'voice_objectives',
    'voice_max_call_seconds',
    'voice_calling_hours',
    'voice_max_retries',
    'voice_retry_delay_minutes',
    'voice_accepts_inbound',
    'voice_transfer_number',
    'voice_max_concurrent_calls',
    'voice_reserved_inbound_slots',
    'voice_max_campaign_concurrent',
    'voice_dedupe_minutes',
    'voice_monthly_minutes_limit',
    'voice_recording_enabled',
    'voice_recording_disclosure',
  ] as const) {
    if (k in body && body[k] !== undefined) payload[k] = body[k];
  }
  if (body.api_key && body.api_key.trim()) {
    payload.api_key_encrypted = encrypt(body.api_key.trim());
  }
  if (
    body.voice_agent_id != null &&
    !(await validVoiceAgentLink(admin, body.workspace_id, body.voice_agent_id))
  ) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.voiceAgentInvalid') },
      { status: 400 }
    );
  }
  if (!body.voice_agent_id) payload.voice_ai_decides = false;

  const { data: created, error } = await admin
    .from('ai_agents')
    .insert(payload)
    .select()
    .single();
  if (error || !created) {
    return serverError(error);
  }

  if (
    body.scope === 'channels' &&
    Array.isArray(body.channels) &&
    body.channels.length
  ) {
    await admin.from('ai_agent_channels').insert(
      body.channels.map((channel) => ({
        agent_id: (created as AiAgent).id,
        channel,
      }))
    );
  }
  if (
    body.product_scope === 'specific' &&
    Array.isArray(body.product_ids) &&
    body.product_ids.length
  ) {
    // Validar que cada product_id pertenece al workspace del agente: el admin
    // client bypassa RLS, así que sin esto un miembro podría asociar productos
    // de otro tenant a su agente. Solo insertamos los que pertenecen.
    const { data: owned } = await admin
      .from('shopify_products')
      .select('id')
      .eq('workspace_id', (created as AiAgent).workspace_id)
      .in('id', body.product_ids);
    const validIds = new Set((owned ?? []).map((p) => p.id as string));
    const rows = body.product_ids
      .filter((product_id) => validIds.has(product_id))
      .map((product_id) => ({
        agent_id: (created as AiAgent).id,
        product_id,
      }));
    if (rows.length) {
      await admin.from('ai_agent_products').insert(rows);
    }
  }

  // El piso de reglas. Un asistente nacía con CERO, y las reglas son justo lo
  // que impide que invente: en una semana de producción, sin ellas, prometió
  // pago contra entrega donde no existe, opinó sobre una condición de la piel
  // y repitió como cierta una condición de venta porque la dijo el cliente.
  // Sólo si la cuenta no tiene ninguna: devolvérselas a quien las borró sería
  // discutirle una decisión suya.
  await sembrarReglasPorDefecto(admin, body.workspace_id);

  // Re-read with relations so the client can drop it into its grid
  // optimistically.
  const { data: fresh } = await admin
    .from('ai_agents')
    .select('*, ai_agent_channels(channel), ai_agent_products(product_id)')
    .eq('id', (created as AiAgent).id)
    .maybeSingle();
  return NextResponse.json(
    { agent: stripKey((fresh ?? created) as AiAgent) },
    { status: 201 }
  );
}

type AgentWithChannels = AiAgent & {
  ai_agent_channels?: { channel: string }[];
};

function stripKey<T extends AiAgent>(
  a: T
): Omit<T, 'api_key_encrypted'> & {
  has_api_key: boolean;
} {
  const { api_key_encrypted, ...rest } = a;
  return { ...rest, has_api_key: Boolean(api_key_encrypted) };
}
