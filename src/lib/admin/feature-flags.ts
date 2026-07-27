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

/** Catálogo de funcionalidades que el admin puede prender/apagar. */
export const FEATURES: FeatureDef[] = [
  {
    key: 'flows',
    labelKey: 'admin.featureFlows',
    descKey: 'admin.featureFlowsDesc',
    sections: ['/menus'],
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

/** Lee todos los flags de la DB. Fail-soft: ante error, todo habilitado. */
export async function getFeatureFlags(db: SupabaseClient): Promise<FeatureFlags> {
  try {
    const { data } = await db.from('feature_flags').select('key, enabled');
    const out: FeatureFlags = {};
    for (const row of (data ?? []) as { key: string; enabled: boolean }[]) {
      out[row.key] = row.enabled;
    }
    return out;
  } catch {
    return {};
  }
}
