/**
 * Guardar un agente: la lista blanca, el choque de canal y los vínculos.
 *
 * Todo esto vivía dentro del PATCH de `/api/ai/agents/[id]`, así que lo único
 * que podía guardar un agente era un navegador con sesión. El Operator no tenía
 * por dónde entrar, y la alternativa —que escribiera el UPDATE por su cuenta—
 * era escribir por segunda vez la regla de "un agente activo por canal y rol".
 * Dos copias de una regla terminan, siempre, diciendo cosas distintas.
 *
 * La route sigue mandando: acá no hay `NextResponse` ni traducciones. Los
 * fallos salen como código y quien llama decide el HTTP y el idioma.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { findChannelConflict } from '../channel-conflict';
import { encrypt } from '@/lib/whatsapp/encryption';
import type { AiAgent } from '../types';
import { mediosDeclarados } from '@/lib/ai/medios-pago';
import { sanitizeTools } from '../toolbox';
import { isDealerDeployment } from '@/lib/dealers/config';

/**
 * Los campos que se pueden guardar desde afuera.
 *
 * Es una lista blanca y no una negra a propósito: `workspace_id`, `id` y
 * `created_by` no se tocan nunca, y agregar una columna a la tabla no la
 * expone sola.
 */
export const AGENT_PATCH_FIELDS: (keyof AiAgent)[] = [
  'name',
  'is_active',
  'persona',
  'knowledge',
  'knowledge_url',
  'language',
  'tone',
  'max_response_chars',
  'reply_delay_seconds',
  'context_messages',
  'response_mode',
  // Autonomia: responde solo o propone y espera (migracion 170)
  'requires_approval',
  'inbound_debounce_seconds',
  // El fusible contra un bucle, ahora con número propio (migración 192)
  'reply_burst_max',
  'reply_when_assigned',
  'reply_outside_hours',
  'business_hours',
  'escalate_keywords',
  'escalate_after_messages',
  'followup_enabled',
  'followup_delay_hours',
  'followup_max_count',
  'proactive_send_mode',
  'puede_crear_pedidos',
  // Cómo cierra la venta (migración 219)
  'cobro_modo',
  // Con qué se puede pagar (migración 228)
  'medios_pago',
  // Rol y permisos por acción (migración 164)
  'role',
  'permissions',
  // La correa de cada herramienta (migración 180)
  'tools',
  'provider',
  'model',
  'scope',
  'product_scope',
  'priority',
  // Voice AI (migration 113 + 115)
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
];

/** El agente como se lo puede devolver: la llave cifrada nunca sale. */
export type AgenteSeguro = Omit<AiAgent, 'api_key_encrypted'> & {
  has_api_key: boolean;
};

export type AgentUpdateFailure =
  /** `scope='channels'` sin ningún canal: el agente no tendría dónde responder. */
  | { code: 'channels_required' }
  /** Otro agente activo del mismo rol ya ocupa esos canales. */
  | { code: 'channel_conflict'; agentName: string; channels: string[] }
  /** The linked voice profile is missing, deleted, disabled or from another workspace. */
  | { code: 'voice_agent_invalid' }
  | { code: 'db'; error: unknown };

export async function validVoiceAgentLink(
  admin: SupabaseClient,
  workspaceId: string,
  voiceAgentId: unknown
): Promise<boolean> {
  if (typeof voiceAgentId !== 'string' || !voiceAgentId.trim()) return false;
  const { data } = await admin
    .from('ai_agents')
    .select('id')
    .eq('id', voiceAgentId)
    .eq('workspace_id', workspaceId)
    .eq('voice_enabled', true)
    .is('deleted_at', null)
    .maybeSingle();
  return Boolean(data);
}

export type AgentUpdateOutcome =
  | { ok: true; agent: AgenteSeguro | null }
  | { ok: false; fail: AgentUpdateFailure };

/**
 * Se queda con lo que el cuerpo de la petición puede escribir.
 *
 * `api_key` entra en claro y sale cifrada: es el único campo que no se copia
 * tal cual, porque la columna guarda el cifrado y no el texto.
 */
export function pickAgentPatch(
  body: Partial<AiAgent> & { api_key?: string }
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const k of AGENT_PATCH_FIELDS) {
    if (k in body) patch[k] = body[k];
  }
  if (isDealerDeployment()) {
    Object.assign(patch, {
      puede_crear_pedidos: false,
      product_scope: 'all',
      cobro_modo: null,
      medios_pago: null,
    });
  }
  if (typeof body.api_key === 'string') {
    patch.api_key_encrypted = body.api_key.trim()
      ? encrypt(body.api_key.trim())
      : null;
  }
  // `tools` es lo que decide si una herramienta se ejecuta sola: se filtra
  // contra el catálogo antes de escribir. El cuerpo de un PATCH lo arma un
  // cliente que no controlamos, y un modo inventado —o una clave que ya no
  // existe— no puede terminar mandando sobre plata que sale.
  if ('tools' in patch) patch.tools = sanitizeTools(patch.tools);
  // Un modo inventado dejaría al agente sin ninguna instrucción de cobro: la
  // restricción de la tabla lo rechazaría con un error feo en vez de guardar.
  if ('cobro_modo' in patch) {
    const v = patch.cobro_modo;
    patch.cobro_modo =
      v === 'checkout' || v === 'chat' || v === 'segun_pago' ? v : 'segun_pago';
  }
  // `null` es un estado, no un error: significa "todavía no lo declaró", y con
  // eso el agente no nombra ningún medio ni confirma contra entrega. Se
  // conserva. Lo que sí se limpia es lo inventado: la columna es jsonb y un
  // medio de pago que el prompt no conoce es una promesa incumplible.
  if ('medios_pago' in patch) {
    patch.medios_pago =
      patch.medios_pago == null
        ? null
        : (mediosDeclarados(patch.medios_pago) ?? []);
  }
  // El tope de ráfaga se acota acá además de en la base: la restricción de la
  // tabla rechazaría un 5000 con un error de Postgres feo, y lo que hay que
  // hacer con un número fuera de rango es recortarlo, no romper el guardado.
  if ('reply_burst_max' in patch) {
    const n = Math.floor(Number(patch.reply_burst_max));
    patch.reply_burst_max = Number.isFinite(n)
      ? Math.min(200, Math.max(0, n))
      : 20;
  }
  if ('voice_max_concurrent_calls' in patch) {
    const n = Math.floor(Number(patch.voice_max_concurrent_calls));
    patch.voice_max_concurrent_calls = Number.isFinite(n)
      ? Math.min(20, Math.max(1, n))
      : 3;
  }
  if ('voice_reserved_inbound_slots' in patch) {
    const n = Math.floor(Number(patch.voice_reserved_inbound_slots));
    const max = Number(patch.voice_max_concurrent_calls ?? 3);
    patch.voice_reserved_inbound_slots = Number.isFinite(n)
      ? Math.min(Math.max(0, max - 1), Math.max(0, n))
      : 0;
  }
  if ('voice_max_campaign_concurrent' in patch) {
    const n = Math.floor(Number(patch.voice_max_campaign_concurrent));
    const max = Number(patch.voice_max_concurrent_calls ?? 3);
    patch.voice_max_campaign_concurrent = Number.isFinite(n)
      ? Math.min(max, Math.max(1, n))
      : 1;
  }
  if ('voice_dedupe_minutes' in patch) {
    const n = Math.floor(Number(patch.voice_dedupe_minutes));
    patch.voice_dedupe_minutes = Number.isFinite(n)
      ? Math.min(1440, Math.max(0, n))
      : 15;
  }
  if ('voice_monthly_minutes_limit' in patch) {
    const n = Math.floor(Number(patch.voice_monthly_minutes_limit));
    patch.voice_monthly_minutes_limit = Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  return patch;
}

export interface AgentUpdateInput {
  agentId: string;
  /** El recorte de cuenta. Quien llama ya verificó que puede tocar este agente. */
  workspaceId: string;
  /** Campos de `ai_agents` ya filtrados por `pickAgentPatch`. */
  patch: Record<string, unknown>;
  /** Reemplaza los canales del agente. Ausente = no se tocan. */
  channels?: string[];
  /** Reemplaza los productos del agente. Ausente = no se tocan. */
  productIds?: string[];
}

/**
 * Aplica el cambio y devuelve cómo quedó el agente.
 *
 * El choque de canal se resuelve sobre el estado FINAL —lo que llega mezclado
 * con lo que ya estaba guardado— y ANTES de tocar nada. Validar contra lo que
 * llega solamente dejaba pasar el caso más común: guardar un agente ya activo
 * cambiándole el rol al de otro que también está activo en el mismo canal.
 */
export async function updateAgent(
  admin: SupabaseClient,
  input: AgentUpdateInput
): Promise<AgentUpdateOutcome> {
  const { agentId, workspaceId, patch } = input;

  const { data: cur } = await admin
    .from('ai_agents')
    .select(
      'is_active, scope, role, voice_agent_id, ai_agent_channels(channel)'
    )
    .eq('id', agentId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  const curRow = cur as {
    is_active: boolean;
    scope: string;
    role?: string | null;
    voice_agent_id?: string | null;
    ai_agent_channels?: { channel: string }[];
  } | null;

  if (
    patch.voice_agent_id != null &&
    (patch.voice_agent_id === agentId ||
      !(await validVoiceAgentLink(admin, workspaceId, patch.voice_agent_id)))
  ) {
    return { ok: false, fail: { code: 'voice_agent_invalid' } };
  }
  const finalVoiceAgentId =
    'voice_agent_id' in patch
      ? (patch.voice_agent_id as string | null)
      : (curRow?.voice_agent_id ?? null);
  // The permission has no meaning without a linked phone profile. Normalize it
  // here so API clients cannot leave a misleading enabled toggle behind.
  if (
    ('voice_agent_id' in patch && !finalVoiceAgentId) ||
    (patch.voice_ai_decides === true && !finalVoiceAgentId)
  ) {
    patch.voice_ai_decides = false;
  }

  const finalActive =
    'is_active' in patch
      ? Boolean(patch.is_active)
      : Boolean(curRow?.is_active);
  const finalScope =
    (patch.scope as string | undefined) ?? curRow?.scope ?? 'workspace';
  const finalChannels = Array.isArray(input.channels)
    ? input.channels
    : (curRow?.ai_agent_channels ?? []).map((c) => c.channel);

  // Un agente de alcance por canal y sin canales no responde en ningún lado, y
  // el detector de conflictos no lo ve porque no ocupa nada. Se valida esté
  // activo o pausado: pausado, el error aparece cuando lo prenden y ya nadie se
  // acuerda de qué cambió.
  if (finalScope === 'channels' && finalChannels.length === 0) {
    return { ok: false, fail: { code: 'channels_required' } };
  }

  if (finalActive) {
    const conflict = await findChannelConflict(admin, {
      workspaceId,
      agentId,
      scope: finalScope,
      channels: finalScope === 'channels' ? finalChannels : [],
      role: (patch.role as string | undefined) ?? curRow?.role ?? 'general',
    });
    if (conflict) {
      return {
        ok: false,
        fail: {
          code: 'channel_conflict',
          agentName: conflict.agentName,
          channels: conflict.channels,
        },
      };
    }
  }

  if (Object.keys(patch).length) {
    const { error } = await admin
      .from('ai_agents')
      .update(patch)
      .eq('id', agentId)
      .eq('workspace_id', workspaceId);
    if (error) return { ok: false, fail: { code: 'db', error } };
  }

  if (Array.isArray(input.channels)) {
    await admin.from('ai_agent_channels').delete().eq('agent_id', agentId);
    if ((patch.scope ?? 'workspace') === 'channels' && input.channels.length) {
      await admin
        .from('ai_agent_channels')
        .insert(
          input.channels.map((channel) => ({ agent_id: agentId, channel }))
        );
    }
  }
  // Aunque no vinieran canales: si el alcance pasó a toda la cuenta, los
  // vínculos viejos sobran y confundirían a la próxima lectura.
  if (patch.scope === 'workspace') {
    await admin.from('ai_agent_channels').delete().eq('agent_id', agentId);
  }

  if (Array.isArray(input.productIds)) {
    await admin.from('ai_agent_products').delete().eq('agent_id', agentId);
    if (
      (patch.product_scope ?? 'all') === 'specific' &&
      input.productIds.length
    ) {
      await admin.from('ai_agent_products').insert(
        input.productIds.map((product_id) => ({
          agent_id: agentId,
          product_id,
        }))
      );
    }
  }
  if (patch.product_scope === 'all') {
    await admin.from('ai_agent_products').delete().eq('agent_id', agentId);
  }

  // Se relee con las relaciones para que quien llamó pueda actualizar su copia
  // local sin un GET extra.
  const { data: fresh } = await admin
    .from('ai_agents')
    .select('*, ai_agent_channels(channel), ai_agent_products(product_id)')
    .eq('id', agentId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (!fresh) return { ok: true, agent: null };
  const { api_key_encrypted, ...rest } = fresh as AiAgent;
  return {
    ok: true,
    agent: { ...rest, has_api_key: Boolean(api_key_encrypted) } as AgenteSeguro,
  };
}
