/**
 * Voz — «¿puede llamar esta cuenta?», en un solo lugar.
 *
 * `enqueueCall` ya tenía todas las barreras, pero las cobra tarde y en
 * silencio: devuelve `{ enqueued: false, reason }` y quien llamó lo escribe en
 * un log que nadie mira. El comercio configura un nodo, lo activa, y no pasa
 * nada — sin un solo cartel que diga qué falta.
 *
 * Esto contesta lo mismo ANTES, con los mismos criterios que `queue.ts`, para
 * que la tarjeta del lienzo, la pantalla de Voz y el botón de la bandeja digan
 * todos la misma frase en vez de adivinar cada uno por su cuenta.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiAgent } from '@/lib/ai/types';
import type { VoiceConnectionConfig } from '@/types';
import { isLiveKitConfigured } from './livekit';
import {
  blockerCodeFromReason,
  VOICE_BLOCKED_FIX_HREF,
  type VoiceBlockerCode,
} from './labels';

export type { VoiceBlockerCode };

export interface VoiceBlocker {
  code: VoiceBlockerCode;
  /** Dónde se arregla. Vacío cuando no lo arregla el comercio (plataforma). */
  fixHref: string | null;
  /** Nombre del agente, cuando el bloqueo es de un agente concreto. */
  agentName?: string;
}

export interface VoiceReadiness {
  ready: boolean;
  blockers: VoiceBlocker[];
  /** El número desde el que sale la llamada, si ya hay uno. */
  phoneNumber: string | null;
}

/** Convierte un `reason` de `enqueueCall` en un bloqueo con su clave y su link. */
export function blockerFromReason(reason: string): VoiceBlocker {
  const code = blockerCodeFromReason(reason);
  return { code, fixHref: VOICE_BLOCKED_FIX_HREF[code] };
}

/** Minutos hablados este mes (mismo cálculo que el guard de `enqueueCall`). */
async function minutesUsedThisMonth(
  db: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
  const { data } = await db
    .from('voice_calls')
    .select('duration_seconds')
    .eq('workspace_id', workspaceId)
    .gte('created_at', monthStart)
    .not('duration_seconds', 'is', null);
  const seconds = ((data ?? []) as { duration_seconds: number | null }[]).reduce(
    (acc, r) => acc + (r.duration_seconds ?? 0),
    0,
  );
  return seconds / 60;
}

/**
 * Todo lo que impide que esta cuenta (o este agente) haga una llamada.
 *
 * Sin `agentId` mira si hay ALGÚN agente que pueda atender el teléfono; con
 * `agentId` mira ese en particular, que es lo que necesita el nodo del lienzo:
 * elegir un agente sin voz tiene que decirlo ahí mismo, no fallar en silencio
 * tres días después cuando entre un pedido.
 */
export async function voiceReadiness(
  db: SupabaseClient,
  workspaceId: string,
  agentId?: string | null,
): Promise<VoiceReadiness> {
  const blockers: VoiceBlocker[] = [];
  const add = (code: VoiceBlockerCode, agentName?: string) =>
    blockers.push({ code, fixHref: VOICE_BLOCKED_FIX_HREF[code], ...(agentName ? { agentName } : {}) });

  if (!isLiveKitConfigured()) add('platform_unavailable');

  // ── La cuenta: conexión, número, freno, tope ──
  const { data: connRow } = await db
    .from('channel_connections')
    .select('config, status')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'voice')
    .maybeSingle();
  const conn = connRow as { config: VoiceConnectionConfig | null; status: string } | null;
  const cfg = conn?.config ?? {};

  if (!conn) {
    add('no_voice_connection');
  } else {
    if (conn.status === 'disconnected') add('voice_disconnected');
    if (!cfg.phone_number) add('no_number');
    if (cfg.kill_switch) add('kill_switch');
    const limit = cfg.monthly_minutes_limit ?? null;
    if (limit && limit > 0) {
      const used = await minutesUsedThisMonth(db, workspaceId);
      if (used >= limit) add('monthly_limit_reached');
    }
  }

  // ── El agente ──
  if (agentId) {
    const { data: agentRow } = await db
      .from('ai_agents')
      .select('id, name, voice_enabled, is_active, deleted_at')
      .eq('id', agentId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    const agent = agentRow as Pick<
      AiAgent,
      'id' | 'name' | 'voice_enabled' | 'is_active'
    > & { deleted_at?: string | null } | null;
    if (!agent) add('agent_not_found');
    else if (agent.deleted_at) add('agent_deleted', agent.name);
    else if (!agent.voice_enabled) add('voice_disabled', agent.name);
    else if (!agent.is_active) add('agent_paused', agent.name);
  } else {
    const { data } = await db
      .from('ai_agents')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('voice_enabled', true)
      .eq('is_active', true)
      .is('deleted_at', null)
      .limit(1);
    if (((data ?? []) as unknown[]).length === 0) add('no_voice_agent');
  }

  return {
    ready: blockers.length === 0,
    blockers,
    phoneNumber: cfg.phone_number ?? null,
  };
}
