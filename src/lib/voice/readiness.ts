/**
 * Voz — «¿puede llamar esta cuenta?», en un solo lugar.
 *
 * `enqueueCall` ya tenía todas las barreras, pero las cobra tarde y en
 * silencio: devuelve `{ enqueued: false, reason }` y quien llamó lo escribe en
 * un log que nadie mira. El comercio configura un nodo, lo activa, y no pasa
 * nada — sin un solo cartel que diga qué falta.
 *
 * Esto contesta lo mismo ANTES, con los mismos criterios que `queue.ts`, para
 * que la tarjeta del lienzo, la pantalla de Llamadas y el botón de la bandeja
 * digan todos la misma frase en vez de adivinar cada uno por su cuenta.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VoiceConnectionConfig } from '@/types';
import { isStale } from '@/lib/cron/schedule';
import { listVoiceAgents } from './agents';
import { isLiveKitConfigured } from './livekit';
import {
  blockerCodeFromReason,
  VOICE_BLOCKED_FIX_HREF,
  VOICE_WORKER_JOB,
  VOICE_WORKER_SCHEDULE,
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
  /**
   * Cosas que NO impiden llamar pero conviene decir. Van aparte de `blockers`
   * justamente para que no toquen `ready`: meter «los entrantes están
   * apagados» entre los bloqueos apagaría las llamadas salientes, que andan.
   */
  warnings: VoiceBlocker[];
  /** El número desde el que sale la llamada, si ya hay uno. */
  phoneNumber: string | null;
  /** Los que pueden atender. La pantalla los lista sin repetir la consulta. */
  agents: { id: string; name: string }[];
  /** ¿Ya se completó alguna llamada? Lo usa el camino de puesta en marcha. */
  firstCallDone: boolean;
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
  agentId?: string
): Promise<number> {
  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString();
  let query = db
    .from('voice_calls')
    .select('duration_seconds')
    .eq('workspace_id', workspaceId)
    .gte('created_at', monthStart)
    .not('duration_seconds', 'is', null);
  if (agentId) query = query.eq('agent_id', agentId);
  const { data } = await query;
  const seconds = (
    (data ?? []) as { duration_seconds: number | null }[]
  ).reduce((acc, r) => acc + (r.duration_seconds ?? 0), 0);
  return seconds / 60;
}

/**
 * ¿El worker que marca los teléfonos sigue vivo?
 *
 * Las variables de LiveKit viven en el servicio web, así que mirarlas sólo
 * prueba que el web sabe a dónde despachar — no que haya alguien del otro lado.
 * Con el worker apagado el despacho ni siquiera falla: LiveKit encola el
 * trabajo, nadie lo toma, la llamada queda en `dialing` y veinte minutos
 * después el barrido la cierra como `worker_timeout`. La pantalla, mientras
 * tanto, decía «listo». Pasó, y costó un mes de silencio.
 *
 * El worker late en `cron_runs` con su propio nombre, así que además de esto
 * aparece solo en el panel de infraestructura, al lado de los crons.
 *
 * AUSENCIA NO ES CAÍDA: si nunca hubo un latido no se levanta el bloqueo. Un
 * worker desplegado antes que el latido no tiene por qué figurar caído, y
 * estrenar esta comprobación no puede apagarle el teléfono a todo el mundo.
 */
export async function voiceWorkerDown(db: SupabaseClient): Promise<boolean> {
  const { data } = await db
    .from('cron_runs')
    .select('started_at')
    .eq('name', VOICE_WORKER_JOB)
    .order('started_at', { ascending: false })
    .limit(1);
  const last = (data ?? [])[0] as { started_at: string } | undefined;
  if (!last) return false;
  return isStale(VOICE_WORKER_SCHEDULE, last.started_at);
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
  agentId?: string | null
): Promise<VoiceReadiness> {
  const blockers: VoiceBlocker[] = [];
  const warnings: VoiceBlocker[] = [];
  const add = (code: VoiceBlockerCode, agentName?: string) =>
    blockers.push({
      code,
      fixHref: VOICE_BLOCKED_FIX_HREF[code],
      ...(agentName ? { agentName } : {}),
    });

  if (!isLiveKitConfigured()) add('platform_unavailable');

  // Las tres consultas que no dependen entre sí, juntas: esto lo llaman cinco
  // pantallas y encadenarlas se nota.
  const [connRes, agentes, workerDown, primera] = await Promise.all([
    db
      .from('channel_connections')
      .select('config, status')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'voice')
      .maybeSingle(),
    // `*` mantiene compatibilidad durante el despliegue gradual de la columna
    // per-agent (migración 244): PostgREST no falla si todavía no existe.
    listVoiceAgents(db, workspaceId),
    voiceWorkerDown(db),
    db
      .from('voice_calls')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'completed'),
  ]);

  if (workerDown) add('worker_down');

  // ── La cuenta: conexión, número, freno, tope ──
  const conn = connRes.data as {
    config: VoiceConnectionConfig | null;
    status: string;
  } | null;
  const cfg = conn?.config ?? {};

  if (!conn) {
    add('no_voice_connection');
  } else {
    if (conn.status === 'disconnected') add('voice_disconnected');
    if (!cfg.phone_number) add('no_number');
    if (cfg.kill_switch) add('kill_switch');
    // Entrantes apagadas es una preferencia del agente, no una alerta global.
    // Se muestra dentro de su configuración; el canal saliente sigue sano.
  }

  // ── El agente ──
  if (agentId) {
    const { data: agentRow } = await db
      .from('ai_agents')
      .select(
        'id, name, voice_enabled, is_active, deleted_at, voice_monthly_minutes_limit'
      )
      .eq('id', agentId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    const agent = agentRow as {
      id: string;
      name: string;
      voice_enabled: boolean;
      is_active: boolean;
      deleted_at?: string | null;
      voice_monthly_minutes_limit?: number | null;
    } | null;
    if (!agent) add('agent_not_found');
    else if (agent.deleted_at) add('agent_deleted', agent.name);
    else if (!agent.voice_enabled) add('voice_disabled', agent.name);
    else if (!agent.is_active) add('agent_paused', agent.name);
    else {
      const limit =
        agent.voice_monthly_minutes_limit === undefined
          ? (cfg.monthly_minutes_limit ?? null)
          : agent.voice_monthly_minutes_limit;
      if (limit && limit > 0) {
        const used = await minutesUsedThisMonth(
          db,
          workspaceId,
          agent.voice_monthly_minutes_limit === undefined ? undefined : agent.id
        );
        if (used >= limit) add('monthly_limit_reached', agent.name);
      }
    }
  } else if (agentes.length === 0) {
    add('no_voice_agent');
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    phoneNumber: cfg.phone_number ?? null,
    agents: agentes.map((a) => ({ id: a.id, name: a.name })),
    firstCallDone: (primera.count ?? 0) > 0,
  };
}
