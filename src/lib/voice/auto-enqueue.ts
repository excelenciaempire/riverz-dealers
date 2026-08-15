/**
 * Voice AI — "the toggles just work" auto-enqueue.
 *
 * So a merchant NEVER has to build an automation for the common cases: when a
 * voice agent has `voice_objectives[callType].enabled`, the matching business
 * event (order created, cart abandoned) auto-enqueues a call. This is the
 * simple path; the `voice_call` automation step remains for power users who
 * want custom branching.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiAgent } from '@/lib/ai/types';
import type { VoiceCallType, VoiceConnectionConfig } from '@/types';
import { enqueueCall } from './queue';

/** Default dedupe window (hours): don't auto-enqueue the same call type for a
 *  contact twice within this span (e.g. Shopify re-delivering the order
 *  webhook). COD merchants raise it (config.dedupe_hours, e.g. 12) to group
 *  several same-contact orders into one confirmation call. */
const DEFAULT_DEDUPE_HOURS = 0.25;

/**
 * Cuánto espera la llamada de carrito abandonado antes de marcar.
 *
 * El cron de carritos manda el WhatsApp de recuperación y, en la misma vuelta,
 * encolaba la llamada: el teléfono sonaba mientras el mensaje seguía sin leer.
 * Una llamada cuesta unas cincuenta veces un mensaje, así que primero se le da
 * su turno al texto; si el cliente contesta o compra en el medio,
 * `skip_if_replied` cancela la llamada antes de marcar.
 */
const CART_RECOVERY_DELAY_MINUTES = 180;

/** Pick the highest-priority voice agent that has THIS objective turned on. */
async function pickAgentForObjective(
  db: SupabaseClient,
  workspaceId: string,
  callType: VoiceCallType,
): Promise<AiAgent | null> {
  const { data } = await db
    .from('ai_agents')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .eq('voice_enabled', true)
    .is('deleted_at', null)
    .order('priority', { ascending: false });
  const agents = (data ?? []) as AiAgent[];
  return (
    agents.find((a) => a.voice_objectives?.[callType]?.enabled === true) ?? null
  );
}

/**
 * If a voice agent opted into this call type, enqueue the call. Fire-and-forget
 * from webhooks/crons; never throws. Returns whether a call was enqueued.
 */
export async function maybeAutoVoiceCall(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    contactId: string;
    callType: VoiceCallType;
    context?: Record<string, unknown>;
  },
): Promise<boolean> {
  try {
    const agent = await pickAgentForObjective(db, input.workspaceId, input.callType);
    if (!agent) return false;

    // Dedupe window is configurable per workspace (COD groups multiple orders).
    const { data: connRow } = await db
      .from('channel_connections')
      .select('config')
      .eq('workspace_id', input.workspaceId)
      .eq('channel', 'voice')
      .maybeSingle();
    const cfg = (connRow as { config?: VoiceConnectionConfig } | null)?.config ?? {};
    const dedupeHours = cfg.dedupe_hours && cfg.dedupe_hours > 0 ? cfg.dedupe_hours : DEFAULT_DEDUPE_HOURS;

    // Dedupe recent auto-calls of the same type for this contact.
    const since = new Date(Date.now() - dedupeHours * 3_600_000).toISOString();
    const { count } = await db
      .from('voice_calls')
      .select('id', { count: 'exact', head: true })
      .eq('contact_id', input.contactId)
      .eq('call_type', input.callType)
      .gte('created_at', since);
    if ((count ?? 0) > 0) return false;

    // Recuperar un carrito es el caso donde el texto suele alcanzar: se le
    // deja actuar primero y sólo se llama si siguió sin respuesta. Confirmar
    // un pedido es lo contrario — cuanto antes, mejor — así que ese sale ya.
    const isCart = input.callType === 'cart_recovery';

    const res = await enqueueCall({
      workspaceId: input.workspaceId,
      agentId: agent.id,
      contactId: input.contactId,
      callType: input.callType,
      delayMinutes: isCart ? CART_RECOVERY_DELAY_MINUTES : undefined,
      context: isCart
        ? { ...(input.context ?? {}), skip_if_replied: true }
        : (input.context ?? {}),
    });
    return res.enqueued;
  } catch (err) {
    console.error('[voice] maybeAutoVoiceCall failed:', err);
    return false;
  }
}
