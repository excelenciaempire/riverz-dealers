/**
 * Voz — quiénes pueden atender el teléfono, en un solo lugar.
 *
 * El criterio («activo, con la voz prendida, sin borrar, y cuyo alcance cubra
 * las llamadas») estaba copiado a mano en cuatro lados: `pickVoiceAgent`, la
 * pantalla de Llamadas, la de campañas y el nodo del lienzo. Tres de las
 * copias eran iguales y la cuarta —`voiceReadiness`, justamente la que el
 * resto trata como fuente única— se olvidaba del alcance.
 *
 * La consecuencia era peor que la duplicación: un agente con alcance por
 * canales SIN el canal de voz hacía que `/api/voice/readiness` contestara
 * «listo» mientras la llamada entrante rebotaba con `no_voice_agent`. La
 * pantalla decía que sí y el teléfono decía que no.
 *
 * Ordenados por prioridad: el primero es el que atiende.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiAgent } from '@/lib/ai/types';

type AgentWithChannels = AiAgent & {
  ai_agent_channels?: { channel: string }[] | null;
};

/**
 * Todos los agentes que hoy pueden atender una llamada de esta cuenta.
 *
 * `columns` existe porque los llamadores quieren cosas distintas: el worker
 * necesita el agente entero para armar el prompt, y una pantalla que sólo
 * pinta una lista de nombres no tiene por qué bajarse el prompt de cada uno.
 *
 * OJO: `scope` y `priority` se agregan SIEMPRE, pase lo que pase el llamador.
 * El filtro de abajo lee `scope` y el orden lee `priority`; pedir sólo
 * `id, name` los dejaba en `undefined`, con lo cual ningún agente pasaba el
 * filtro y la cuenta figuraba sin nadie que atendiera el teléfono. Un filtro
 * sobre una columna que no se trajo no falla: descarta todo en silencio.
 */
export async function listVoiceAgents(
  db: SupabaseClient,
  workspaceId: string,
  columns = '*',
): Promise<AgentWithChannels[]> {
  const select =
    columns.trim() === '*'
      ? '*'
      : `${columns}, scope, priority`;
  const { data } = await db
    .from('ai_agents')
    .select(`${select}, ai_agent_channels(channel)`)
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .eq('voice_enabled', true)
    .is('deleted_at', null);

  const agents = (data ?? []) as unknown as AgentWithChannels[];
  return agents
    .filter(
      (a) =>
        a.scope === 'workspace' ||
        (a.ai_agent_channels ?? []).some((c) => c.channel === 'voice'),
    )
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/** El que atiende: el de mayor prioridad, o ninguno. */
export async function pickVoiceAgent(
  db: SupabaseClient,
  workspaceId: string,
): Promise<AiAgent | null> {
  return (await listVoiceAgents(db, workspaceId))[0] ?? null;
}
