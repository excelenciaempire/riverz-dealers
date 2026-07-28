import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'

/**
 * De quién es la clave que paga una llamada a Anthropic.
 *
 *   agent    — la que el comercio cargó en su agente. Paga él (BYOK).
 *   platform — la de Riverz, administrada desde /admin/ia. Pagamos nosotros.
 *   env      — ANTHROPIC_API_KEY del servidor. Es lo que había antes de todo
 *              esto y se conserva como último recurso para no dejar a nadie
 *              sin servicio durante la transición.
 */
export type KeySource = 'agent' | 'platform' | 'env'

export interface ResolvedKey {
  key: string
  source: KeySource
}

export type PlatformAiMode = 'all' | 'selected' | 'off'

interface PlatformSettings {
  mode: PlatformAiMode
  key: string | null
}

/**
 * La configuración de plataforma se consulta en CADA respuesta del agente, así
 * que se cachea un minuto en memoria. Un cambio en el panel tarda como mucho
 * eso en aplicarse — aceptable para algo que se toca una vez al mes, y evita
 * una consulta extra en el camino más caliente del producto.
 */
let cache: { at: number; value: PlatformSettings } | null = null
const CACHE_MS = 60_000

export function invalidatePlatformKeyCache(): void {
  cache = null
}

async function loadSettings(db: SupabaseClient): Promise<PlatformSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value
  const empty: PlatformSettings = { mode: 'off', key: null }
  try {
    const { data } = await db
      .from('platform_ai_settings')
      .select('mode, anthropic_key_encrypted')
      .eq('id', true)
      .maybeSingle()
    const row = data as {
      mode?: string
      anthropic_key_encrypted?: string | null
    } | null
    const mode: PlatformAiMode =
      row?.mode === 'all' || row?.mode === 'selected' ? row.mode : 'off'
    let key: string | null = null
    if (row?.anthropic_key_encrypted) {
      try {
        key = decrypt(row.anthropic_key_encrypted)
      } catch {
        // Clave ilegible (se rotó ENCRYPTION_KEY): mejor caer a la del
        // comercio o a la del entorno que romper la respuesta.
        key = null
      }
    }
    const value: PlatformSettings = { mode, key }
    cache = { at: Date.now(), value }
    return value
  } catch {
    return empty
  }
}

/** ¿Cubre la clave de Riverz a esta cuenta? */
export async function workspaceUsesPlatformKey(
  db: SupabaseClient,
  workspaceId: string,
): Promise<boolean> {
  const s = await loadSettings(db)
  if (s.mode === 'off' || !s.key) return false
  if (s.mode === 'all') return true
  const { data } = await db
    .from('platform_ai_workspaces')
    .select('enabled')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  return (data as { enabled?: boolean } | null)?.enabled === true
}

/**
 * Resuelve con qué clave se hace la llamada, y deja dicho cuál fue.
 *
 * El orden es deliberado: **la del comercio manda**. Si cargó la suya es
 * porque quiere pagar con ella —o porque tiene un acuerdo aparte— y que la
 * clave de Riverz la pisara silenciosamente sería facturarle a la casa un
 * consumo que el comercio ya estaba pagando.
 *
 * Devuelve null cuando no hay ninguna: quien llama decide si eso es un error
 * (contestar un DM) o simplemente no hacer nada (resumir una conversación).
 */
export async function resolveAnthropicKey(
  db: SupabaseClient,
  opts: { workspaceId: string; agentKeyEncrypted?: string | null },
): Promise<ResolvedKey | null> {
  if (opts.agentKeyEncrypted) {
    try {
      const k = decrypt(opts.agentKeyEncrypted)
      if (k) return { key: k, source: 'agent' }
    } catch {
      /* sigue al siguiente origen */
    }
  }

  const s = await loadSettings(db)
  if (s.key && (await workspaceUsesPlatformKey(db, opts.workspaceId))) {
    return { key: s.key, source: 'platform' }
  }

  const env = process.env.ANTHROPIC_API_KEY
  if (env) return { key: env, source: 'env' }
  return null
}
