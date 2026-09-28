import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/automations/admin-client'
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

/** Environment fallback remains owned by the central key resolver, including admin probes. */
export function platformAnthropicEnvKey(): string | null {
  return process.env.ANTHROPIC_API_KEY || null
}

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

/**
 * ¿Esta cuenta paga su IA con su propia clave?
 *
 * Se lee con la llave de servicio y no con el cliente de quien llama: la
 * suscripción no tiene políticas de lectura, y un cliente de sesión la vería
 * vacía y le daría la clave de Riverz a una cuenta BYOK.
 *
 * Si la consulta falla se responde que no: una base caída no puede dejar muda
 * a todas las cuentas. Ese resultado no se cachea.
 */
export async function esCuentaByok(workspaceId: string): Promise<boolean> {
  if (!workspaceId) return false
  // Billing can be changed by an admin on another replica. Never cache the
  // payer: invalidating one process cannot invalidate the other workers.
  try {
    const { data, error } = await supabaseAdmin()
      .from('workspace_subscriptions')
      .select('modelo_cobro')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (error) return false
    const value = (data as { modelo_cobro?: string } | null)?.modelo_cobro === 'byok'
    return value
  } catch {
    return false
  }
}

/** La clave que el comercio cargó en alguno de sus agentes; primero los activos. */
async function claveDelComercio(workspaceId: string): Promise<ResolvedKey | null> {
  const { data } = await supabaseAdmin()
    .from('ai_agents')
    .select('api_key_encrypted')
    .eq('workspace_id', workspaceId)
    .not('api_key_encrypted', 'is', null)
    .order('is_active', { ascending: false })
    .limit(5)
  for (const row of (data ?? []) as { api_key_encrypted: string }[]) {
    try {
      const key = decrypt(row.api_key_encrypted)
      if (key) return { key, source: 'agent' }
    } catch {
      /* la siguiente */
    }
  }
  return null
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
 *
 * Una cuenta BYOK sólo usa la suya: sin ella no hay respaldo de Riverz, ni la
 * de plataforma ni la del entorno. Quien no pasa la clave del agente recibe la
 * que el comercio cargó en cualquiera de sus agentes.
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

  if (await esCuentaByok(opts.workspaceId)) {
    return claveDelComercio(opts.workspaceId)
  }

  const s = await loadSettings(db)
  if (s.key && (await workspaceUsesPlatformKey(db, opts.workspaceId))) {
    return { key: s.key, source: 'platform' }
  }

  const env = process.env.ANTHROPIC_API_KEY
  if (env) return { key: env, source: 'env' }
  return null
}

/**
 * ¿El proveedor rechazó ESTA clave, o falló la llamada por otra cosa?
 *
 * La diferencia decide si tiene sentido reintentar con otra clave. Un 429 o un
 * 529 no mejoran por cambiar de pagador —es el mismo modelo saturado—, pero una
 * clave revocada o sin saldo sí: la de la plataforma está ahí al lado.
 *
 * Ojo con el saldo: Anthropic **no** devuelve 402. Manda un `400
 * invalid_request_error` con "Your credit balance is too low", que es
 * indistinguible de un pedido mal armado si sólo se mira el código. Por eso se
 * lee el mensaje. Fue exactamente el caso que dejó a un comercio sin respuestas
 * automáticas durante dos semanas.
 */
export function claveRechazada(err: unknown): boolean {
  const status =
    err && typeof err === 'object' && 'status' in err
      ? Number((err as { status?: number }).status)
      : undefined
  if (status === 401 || status === 402 || status === 403) return true
  const msg =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message ?? '')
      : ''
  return /credit balance is too low|invalid x-api-key|authentication_error/i.test(
    msg,
  )
}
