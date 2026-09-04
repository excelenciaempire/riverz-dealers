import type { SupabaseClient } from '@supabase/supabase-js';
import { translate } from '@/lib/i18n/translate';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/config';

/**
 * Un solo agente ACTIVO por canal Y ROL.
 *
 * Nació como "uno por canal": dos agentes activos pisándose el mismo canal era
 * confuso e impredecible, porque los dos querían contestar lo mismo. Ese sigue
 * siendo el problema, pero la regla era más ancha que el problema — bloqueaba
 * también el caso que sí tiene sentido: uno que vende y otro que atiende
 * postventa, en WhatsApp, sobre el mismo catálogo. No se pisan porque no
 * contestan lo mismo, y el runner los arbitra por rol (`roles.ts`).
 *
 * Así que el choque ahora es por par (canal, rol). Dos agentes con el mismo rol
 * en el mismo canal siguen siendo un choque, y se bloquea al guardar con un
 * mensaje claro en vez de desactivar a otro en silencio.
 */

// Canales sobre los que el asistente de IA puede responder (DM + email). Un
// agente de scope 'workspace' ocupa TODOS estos; uno de scope 'channels' solo
// los suyos.
// `voice` forma parte del alcance del agente, pero no del detector de choque:
// varios perfiles de voz son válidos y `listVoiceAgents` los enruta por
// prioridad. Tratarlo como un chat hacía imposible crear dos voces.
export const AI_CHANNELS = [
  'whatsapp',
  'instagram',
  'messenger',
  'gmail',
  'outlook',
  'mercadolibre',
  'voice',
  'webchat',
] as const;

// Los canales son marcas y no se traducen; las llamadas sí son una palabra
// común, así que sale del catálogo i18n en vez de quedar fija en español
// dentro de un mensaje de error que el usuario puede estar leyendo en inglés.
const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  gmail: 'Gmail',
  outlook: 'Outlook',
  mercadolibre: 'Mercado Libre',
};

export function channelLabels(channels: string[], locale?: Locale): string {
  return channels
    .map((c) => {
      if (c === 'voice')
        return translate(locale ?? DEFAULT_LOCALE, 'nav.voice');
      if (c === 'webchat')
        return translate(locale ?? DEFAULT_LOCALE, 'nav.webchat');
      return CHANNEL_LABELS[c] ?? c;
    })
    .join(', ');
}

/**
 * Los canales que este agente ocupa DE VERDAD.
 *
 * `voice` sólo cuenta si el agente tiene la voz encendida. La fila del canal
 * se conserva aunque se apague (apagarla y volver a prenderla no debe borrar
 * lo que el comercio eligió), así que sin este filtro un agente con la voz
 * apagada seguía "ocupando" las llamadas y bloqueaba a otro agente que sí
 * podía atenderlas, con un conflicto que la pantalla ni siquiera muestra.
 */
function effectiveChannels(scope: string, channels: string[]): string[] {
  const allowed = AI_CHANNELS as readonly string[];
  const base =
    scope === 'workspace'
      ? [...AI_CHANNELS]
      : channels.filter((c) => allowed.includes(c));
  return base.filter((c) => c !== 'voice');
}

export interface ChannelConflict {
  agentName: string;
  channels: string[];
}

/**
 * ¿El agente que se está guardando (activo) choca con otro agente activo del
 * workspace en algún canal? Devuelve el primer conflicto, o null si no hay.
 * `agentId` es el id del que se guarda (se excluye de la búsqueda); null al crear.
 */
export async function findChannelConflict(
  admin: SupabaseClient,
  args: {
    workspaceId: string;
    agentId: string | null;
    scope: string;
    channels: string[];
    /** Si la voz está apagada, este agente no ocupa el canal de llamadas. */
    voiceEnabled?: boolean;
    /** Migración 164. Ausente = 'general', como los agentes anteriores. */
    role?: string | null;
  }
): Promise<ChannelConflict | null> {
  const mine = new Set(effectiveChannels(args.scope, args.channels));
  if (mine.size === 0) return null;
  const miRol = args.role ?? 'general';

  let query = admin
    .from('ai_agents')
    .select('id, name, scope, role, voice_enabled, ai_agent_channels(channel)')
    .eq('workspace_id', args.workspaceId)
    .eq('is_active', true)
    .is('deleted_at', null);
  if (args.agentId) query = query.neq('id', args.agentId);
  const { data } = await query;

  for (const a of (data ?? []) as Array<{
    name: string | null;
    scope: string;
    role?: string | null;
    voice_enabled?: boolean | null;
    ai_agent_channels?: { channel: string }[];
  }>) {
    // Roles distintos conviven: se reparten los mensajes, no se los disputan.
    if ((a.role ?? 'general') !== miRol) continue;
    const theirs = effectiveChannels(
      a.scope,
      (a.ai_agent_channels ?? []).map((c) => c.channel)
    );
    const overlap = theirs.filter((c) => mine.has(c));
    if (overlap.length > 0) {
      return { agentName: a.name ?? 'Asistente', channels: overlap };
    }
  }
  return null;
}
