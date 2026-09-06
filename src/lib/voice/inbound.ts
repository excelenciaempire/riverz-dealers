/**
 * Voice AI — inbound call resolution.
 *
 * An inbound SIP job arrives with no dispatch metadata; the worker calls
 * GET /api/internal/voice/context?did=&caller=. We resolve the workspace by
 * the called DID, pick its voice agent, resolve/create the caller contact,
 * and create the inbound voice_calls row — then the same context builder
 * produces the system prompt.
 */
import { selectAll } from '@/lib/db/paginate';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, VoiceCall, VoiceConnectionConfig } from '@/types';
import { normalizeToWhatsApp, phonesMatch } from '@/lib/whatsapp/phone-utils';
import {
  listVoiceAgents,
  pickInboundVoiceAgent,
  pickVoiceAgent,
} from './agents';
import { withVoiceExecutionMeta } from './execution-context';
import { motorApagado } from '@/lib/workspaces/motor';
import { puertaDeIa } from '@/lib/wallet/puerta';
import { voiceProviderHealth } from './provider-health';

function toE164(raw: string): string {
  const t = raw.trim();
  return t.startsWith('+') ? t : `+${t.replace(/[^\d]/g, '')}`;
}

/**
 * El número de quien llama, en E.164 de verdad.
 *
 * Telnyx entrega el ANI SIN código de país en las llamadas nacionales: una
 * llamada de un móvil de Florida a un número de EE.UU. llega como
 * `9544945872`. `toE164` sólo le antepone un `+`, así que quedaba guardado
 * `+9544945872` — un número al que no se puede devolver la llamada ni mandar
 * un WhatsApp. Visto en producción el 2026-08-25, en la primera llamada
 * entrante de la historia.
 *
 * El país del DID es la pista correcta para completarlo: quien marca un número
 * local casi siempre está en el mismo país.
 */
function callerToE164(raw: string, didCountry?: string | null): string {
  const normalizado = normalizeToWhatsApp(raw, didCountry ?? null);
  // `normalizeToWhatsApp` devuelve vacío si no logra validarlo; ahí se guarda
  // lo que llegó, que es mejor que perder de dónde vino la llamada.
  return normalizado ? `+${normalizado}` : toE164(raw);
}

/**
 * Best voice-enabled agent for a workspace (highest priority).
 *
 * Vive en `./agents` desde que `voiceReadiness` resultó tener una copia
 * distinta del criterio. Se re-exporta acá para no tocar a quien ya lo
 * importaba de este módulo.
 */
export { pickVoiceAgent };

/** Resolve or create the caller contact for an inbound call. */
async function resolveContact(
  db: SupabaseClient,
  workspaceId: string,
  /** Ya normalizado por `callerToE164`. */
  e164: string
): Promise<Contact | null> {
  const last8 = e164.slice(-8);
  // Match any existing contact by phone (cross-channel), preferring the oldest.
  const { data: candidates } = await db
    .from('contacts')
    .select('*')
    .eq('workspace_id', workspaceId)
    .not('phone', 'is', null)
    .like('phone', `%${last8}`)
    .order('created_at', { ascending: true });
  const rows = (candidates ?? []) as Contact[];
  const match = rows.find((c) => c.phone && phonesMatch(c.phone, e164));
  if (match) return match;

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      workspace_id: workspaceId,
      channel: 'voice',
      external_id: e164,
      phone: e164,
    })
    .select()
    .single();
  if (error) {
    console.error('[voice] create inbound contact failed:', error);
    return null;
  }
  return created as Contact;
}

export type InboundResolution =
  | { ok: true; mode: 'ai'; call: VoiceCall }
  | {
      ok: true;
      mode: 'fallback';
      call: VoiceCall;
      reason: string;
      transferNumber: string | null;
      language: 'es' | 'en';
    }
  | { ok: false; reason: string };

/**
 * Create the inbound voice_calls row for an incoming call. Returns the row
 * so the context builder can produce the system prompt.
 */
export async function resolveInboundCall(
  db: SupabaseClient,
  input: { did: string; caller: string; sessionId?: string }
): Promise<InboundResolution> {
  const did = toE164(input.did);

  // Find the workspace that owns this DID. Match on EXACT E.164 equality (not
  // a last-8-digits fuzzy match) so two workspaces whose numbers merely share
  // the last 8 digits can't cross-route inbound calls.
  // Paginada: PostgREST corta en 1000 sin avisar, y una llamada al número de la
  // conexión 1001 no habría encontrado dueño — un teléfono que suena y nadie
  // atiende, sin error en ningún lado.
  const conns = await selectAll<{
    workspace_id: string;
    config: VoiceConnectionConfig | null;
    status: string;
  }>(db, 'channel_connections', (q) => q.eq('channel', 'voice'), {
    select: 'id, workspace_id, config, status',
  });
  const matches = conns.filter((c) => {
    const num = c.config?.phone_number;
    return num && toE164(num) === did;
  });
  if (matches.length === 0) return { ok: false, reason: 'unknown_did' };
  // Ambiguous: two workspaces claim the same DID (config is merchant-supplied
  // and unverified). Refuse rather than guess and route to the wrong tenant.
  if (matches.length > 1) return { ok: false, reason: 'ambiguous_did' };
  const conn = matches[0];
  if (conn.status === 'disconnected')
    return { ok: false, reason: 'disconnected' };
  const cfg = conn.config ?? {};
  if (cfg.kill_switch) return { ok: false, reason: 'kill_switch' };

  const caller = callerToE164(input.caller, cfg.country);

  const contact = await resolveContact(db, conn.workspace_id, caller);
  if (!contact) return { ok: false, reason: 'contact_failed' };
  // `voice_opt_out` significa «no me llamen». No debe rechazar una llamada
  // que la propia persona inició hacia el negocio.

  // Idempotency is tied to the physical SIP leg, never the caller. A customer
  // may genuinely call twice at the same time from one switchboard number.
  if (input.sessionId) {
    const { data: existing } = await db
      .from('voice_calls')
      .select('*')
      .eq('external_call_id', input.sessionId)
      .maybeSingle();
    if (existing) {
      const call = existing as VoiceCall;
      const fallbackReason = String(
        call.context?.fallback_reason ?? 'unavailable'
      );
      return call.agent_id
        ? { ok: true, mode: 'ai', call }
        : {
            ok: true,
            mode: 'fallback',
            call,
            reason: fallbackReason,
            transferNumber: cfg.fallback_transfer_number ?? null,
            language: cfg.fallback_language === 'en' ? 'en' : 'es',
          };
    }
  }

  const [agent, allAgents, wallet, motorOff, providers] = await Promise.all([
    pickInboundVoiceAgent(db, conn.workspace_id),
    listVoiceAgents(db, conn.workspace_id),
    puertaDeIa(db, conn.workspace_id),
    motorApagado(db, conn.workspace_id),
    voiceProviderHealth(db),
  ]);
  const hasInboundAgent = allAgents.some(
    (candidate) => candidate.voice_accepts_inbound !== false
  );
  const legacyInboundDisabled =
    !cfg.inbound_enabled &&
    allAgents.length > 0 &&
    allAgents.every(
      (candidate) => candidate.voice_accepts_inbound === undefined
    );
  const fallbackReason =
    cfg.inbound_enabled === false || legacyInboundDisabled
      ? 'inbound_disabled'
      : motorOff
        ? 'motor_apagado'
        : !wallet.puede
          ? (wallet.motivo ?? 'sin_saldo')
          : providers.aiBlocking
            ? 'provider_unavailable'
            : !agent && hasInboundAgent
              ? 'capacity_unavailable'
              : !agent
                ? 'no_voice_agent'
                : null;
  const fallback = Boolean(fallbackReason);

  const { data: inserted, error } = await db
    .from('voice_calls')
    .insert({
      workspace_id: conn.workspace_id,
      agent_id: fallback ? null : agent!.id,
      contact_id: contact.id,
      direction: 'inbound',
      call_type: 'inbound',
      phone: caller,
      language: fallback
        ? cfg.fallback_language === 'en'
          ? 'en'
          : 'es'
        : agent!.language || 'es',
      status: 'in_progress',
      context: withVoiceExecutionMeta(
        fallback ? { fallback_reason: fallbackReason } : {},
        { origin: 'inbound' }
      ),
      dispatch_priority: 500,
      external_call_id: input.sessionId ?? null,
      attempt: 1,
      max_attempts: 1,
      started_at: new Date().toISOString(),
      answered_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error || !inserted) {
    if ((error as { code?: string }).code === '23505' && input.sessionId) {
      const { data: winner } = await db
        .from('voice_calls')
        .select('*')
        .eq('external_call_id', input.sessionId)
        .maybeSingle();
      if (winner) {
        const call = winner as VoiceCall;
        return call.agent_id
          ? { ok: true, mode: 'ai', call }
          : {
              ok: true,
              mode: 'fallback',
              call,
              reason: fallbackReason ?? 'unavailable',
              transferNumber: cfg.fallback_transfer_number ?? null,
              language: cfg.fallback_language === 'en' ? 'en' : 'es',
            };
      }
    }
    return {
      ok: false,
      reason: `insert_failed:${error?.message ?? 'unknown'}`,
    };
  }
  const call = inserted as VoiceCall;
  return fallback
    ? {
        ok: true,
        mode: 'fallback',
        call,
        reason: fallbackReason!,
        transferNumber: cfg.fallback_transfer_number ?? null,
        language: cfg.fallback_language === 'en' ? 'en' : 'es',
      }
    : { ok: true, mode: 'ai', call };
}
