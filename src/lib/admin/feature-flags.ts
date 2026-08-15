/**
 * Feature flags — plataforma-wide, controlados desde el panel de admin.
 *
 * Un flag apaga una funcionalidad de la app para TODOS los comercios: se
 * esconde del menú y su URL queda bloqueada (redirige) — salvo para los
 * platform admins, que siempre la ven/acceden (para poder probarla apagada).
 *
 * Modelo: tabla singleton `feature_flags(key, enabled)`. Una funcionalidad SIN
 * fila = habilitada (así sumar el sistema no apaga nada por accidente); solo lo
 * explícitamente `enabled=false` se esconde.
 *
 * Este archivo es puro (sin imports server-only) para poder usarse también en
 * el cliente (sidebar / SectionGuard) con el mapa de rutas→feature.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface FeatureDef {
  /** Clave estable guardada en la DB. */
  key: string;
  /** i18n key del nombre (namespace admin). */
  labelKey: string;
  /** i18n key de la descripción. */
  descKey: string;
  /** Rutas (canónicas, prefijo) que esta funcionalidad cubre. */
  sections: string[];
}

/**
 * Catálogo de funcionalidades que el admin puede prender/apagar.
 *
 * `sections` son rutas CANÓNICAS (carpetas en español). Quien las compare
 * contra la URL del navegador debe pasar antes por `canonicalizePath()`, que
 * es lo que hacen el sidebar (usa el href canónico) y el SectionGuard.
 *
 * No se listan aquí las secciones núcleo (Inicio, Bandeja, Contactos,
 * Asistente, Productos, Integraciones, Ajustes): apagarlas dejaría la app sin
 * nada utilizable.
 */
export const FEATURES: FeatureDef[] = [
  {
    key: 'flows',
    labelKey: 'admin.featureFlows',
    descKey: 'admin.featureFlowsDesc',
    sections: ['/menus'],
  },
  {
    key: 'voice',
    labelKey: 'admin.featureVoice',
    descKey: 'admin.featureVoiceDesc',
    sections: ['/voz'],
  },
  {
    key: 'comments',
    labelKey: 'admin.featureComments',
    descKey: 'admin.featureCommentsDesc',
    sections: ['/comentarios'],
  },
  {
    key: 'instagram_agent',
    labelKey: 'admin.featureInstagramAgent',
    descKey: 'admin.featureInstagramAgentDesc',
    sections: ['/agente-instagram'],
  },
  {
    key: 'campaigns',
    labelKey: 'admin.featureCampaigns',
    descKey: 'admin.featureCampaignsDesc',
    sections: ['/campanas'],
  },
  {
    key: 'templates',
    labelKey: 'admin.featureTemplates',
    descKey: 'admin.featureTemplatesDesc',
    sections: ['/plantillas'],
  },
  {
    key: 'automations',
    labelKey: 'admin.featureAutomations',
    descKey: 'admin.featureAutomationsDesc',
    sections: ['/automatizaciones'],
  },
  {
    key: 'orders',
    labelKey: 'admin.featureOrders',
    descKey: 'admin.featureOrdersDesc',
    sections: ['/pedidos'],
  },
];

export type FeatureFlags = Record<string, boolean>;

/** ¿La funcionalidad `key` está habilitada? Ausente = habilitada. */
export function isFeatureEnabled(flags: FeatureFlags, key: string): boolean {
  return flags[key] !== false;
}

/** Feature que cubre esta ruta (o null si ninguna la gatea). */
export function featureForPath(path: string): string | null {
  for (const f of FEATURES) {
    if (f.sections.some((s) => path === s || path.startsWith(s + '/'))) return f.key;
  }
  return null;
}

/**
 * ¿Se puede ver/acceder esta ruta? Un platform admin siempre puede; el resto
 * solo si la feature que la cubre está habilitada (o no está gateada).
 */
export function canUsePath(
  path: string,
  flags: FeatureFlags,
  isPlatformAdmin: boolean,
): boolean {
  if (isPlatformAdmin) return true;
  const feat = featureForPath(path);
  return !feat || isFeatureEnabled(flags, feat);
}

/**
 * Lee los flags que le corresponden a un comercio.
 *
 * Dos capas: el valor global (`feature_flags`) y la excepción por comercio
 * (`workspace_feature_flags`, migración 156), que lo pisa. Se resuelven acá y
 * se devuelve un solo mapa ya plano, así que nada de lo que consume esto
 * —`canUsePath`, el sidebar, el SectionGuard— tiene que enterarse de que hay
 * dos capas.
 *
 * Sin `workspaceId` devuelve sólo los globales, que es lo que quiere el panel
 * de plataforma cuando muestra la configuración de base.
 *
 * Fail-soft: ante error, todo habilitado. Un problema leyendo esta tabla no
 * puede dejar a un comercio sin la mitad de la aplicación.
 */
export async function getFeatureFlags(
  db: SupabaseClient,
  workspaceId?: string | null,
): Promise<FeatureFlags> {
  try {
    const [globalRes, wsRes] = await Promise.all([
      db.from('feature_flags').select('key, enabled'),
      workspaceId
        ? db
            .from('workspace_feature_flags')
            .select('key, enabled')
            .eq('workspace_id', workspaceId)
        : Promise.resolve({ data: [] as { key: string; enabled: boolean }[] }),
    ]);

    const out: FeatureFlags = {};
    for (const row of (globalRes.data ?? []) as { key: string; enabled: boolean }[]) {
      out[row.key] = row.enabled;
    }
    // La excepción del comercio va después: gana sobre el global.
    for (const row of ((wsRes as { data?: { key: string; enabled: boolean }[] }).data ??
      []) as { key: string; enabled: boolean }[]) {
      out[row.key] = row.enabled;
    }
    return out;
  } catch {
    return {};
  }
}

/** Sólo las excepciones de un comercio, para poder mostrarlas y editarlas. */
export async function getWorkspaceOverrides(
  db: SupabaseClient,
  workspaceId: string,
): Promise<FeatureFlags> {
  try {
    const { data } = await db
      .from('workspace_feature_flags')
      .select('key, enabled')
      .eq('workspace_id', workspaceId);
    const out: FeatureFlags = {};
    for (const row of (data ?? []) as { key: string; enabled: boolean }[]) {
      out[row.key] = row.enabled;
    }
    return out;
  } catch {
    return {};
  }
}
