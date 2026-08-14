import type { SupabaseClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { publicBaseUrl } from '@/lib/base-url'

/**
 * OAuth de Mercado Pago: conectar con un clic.
 *
 * Mercado Pago comparte el sistema de aplicaciones con Mercado Libre, así
 * que las mismas credenciales que ya usa ese canal sirven acá. Lo que
 * cambia es el dominio de autorización y el endpoint de token.
 *
 * El token de acceso vence a los **180 días** y sólo el flujo de
 * autorización devuelve `refresh_token`. Sin renovarlo, la recuperación de
 * pagos se apaga sola medio año después de conectarse y sin ningún aviso:
 * por eso el refresco no es un extra, es parte de la conexión.
 */

const AUTH_URL = 'https://auth.mercadopago.com/authorization'
const TOKEN_URL = 'https://api.mercadopago.com/oauth/token'

/** Margen para renovar antes de que venza de verdad. */
const RENEW_BEFORE_MS = 7 * 86_400_000

export function oauthConfigured(): boolean {
  return Boolean(clientId() && clientSecret())
}

function clientId(): string {
  // Reusa la aplicación de Mercado Libre si no hay una propia: es la misma
  // consola de desarrolladores y la misma app sirve para los dos.
  return process.env.MERCADOPAGO_CLIENT_ID || process.env.MERCADOLIBRE_CLIENT_ID || ''
}

function clientSecret(): string {
  return process.env.MERCADOPAGO_CLIENT_SECRET || process.env.MERCADOLIBRE_CLIENT_SECRET || ''
}

export function redirectUri(): string {
  return `${publicBaseUrl()}/api/mercadopago/oauth/callback`
}

/**
 * `state` firmado con el workspace adentro.
 *
 * Cumple las dos funciones de una vez: al volver sabemos a qué cuenta
 * pertenece la autorización sin guardar nada en el medio, y la firma impide
 * que alguien arme un callback apuntando a un workspace ajeno.
 */
export function signState(workspaceId: string): string {
  const mac = createHmac('sha256', process.env.ENCRYPTION_KEY ?? '')
    .update(`mp-oauth:${workspaceId}`)
    .digest('base64url')
    .slice(0, 32)
  return `${workspaceId}.${mac}`
}

export function verifyState(state: string): string | null {
  const [workspaceId, mac] = (state ?? '').split('.')
  if (!workspaceId || !mac) return null
  const expected = signState(workspaceId).split('.')[1]
  const a = Buffer.from(expected)
  const b = Buffer.from(mac)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return workspaceId
}

export function authorizeUrl(workspaceId: string): string {
  const qs = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    platform_id: 'mp',
    state: signState(workspaceId),
    redirect_uri: redirectUri(),
  })
  return `${AUTH_URL}?${qs}`
}

export interface MpTokens {
  accessToken: string
  refreshToken: string | null
  userId: string | null
  expiresAt: string | null
}

function parseTokens(data: Record<string, unknown>): MpTokens {
  const expiresIn = Number(data.expires_in)
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    userId: data.user_id !== undefined && data.user_id !== null ? String(data.user_id) : null,
    expiresAt: Number.isFinite(expiresIn)
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null,
  }
}

async function postToken(body: Record<string, string>): Promise<MpTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`mercadopago oauth ${res.status}: ${text.slice(0, 200)}`)
  }
  return parseTokens(JSON.parse(text) as Record<string, unknown>)
}

export function exchangeCode(code: string): Promise<MpTokens> {
  return postToken({
    client_id: clientId(),
    client_secret: clientSecret(),
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
  })
}

export function refreshTokens(refreshToken: string): Promise<MpTokens> {
  return postToken({
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
}

interface StoredIntegration {
  api_key_encrypted: string
  refresh_token_encrypted: string | null
  expires_at: string | null
}

/**
 * El access token del workspace, renovado si está por vencer.
 *
 * Se renueva acá y no en un cron aparte porque el momento en que hace falta
 * es exactamente el momento en que se va a usar, y así una cuenta que estuvo
 * dormida seis meses vuelve sola en la primera corrida en vez de fallar.
 *
 * Si no hay refresh (conexión hecha con token pegado) devuelve el token tal
 * cual: no hay nada que renovar y sigue siendo válido hasta que lo roten.
 */
export async function freshAccessToken(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('workspace_integrations')
    .select('api_key_encrypted, refresh_token_encrypted, expires_at')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'mercadopago')
    .eq('is_active', true)
    .maybeSingle()

  const row = data as StoredIntegration | null
  if (!row) return null

  let token: string
  try {
    token = decrypt(row.api_key_encrypted)
  } catch {
    return null
  }

  const dueSoon =
    row.expires_at !== null &&
    new Date(row.expires_at).getTime() - Date.now() < RENEW_BEFORE_MS
  if (!dueSoon || !row.refresh_token_encrypted) return token

  try {
    const next = await refreshTokens(decrypt(row.refresh_token_encrypted))
    await admin
      .from('workspace_integrations')
      .update({
        api_key_encrypted: encrypt(next.accessToken),
        // Mercado Pago rota el refresh en cada uso: quedarse con el viejo
        // deja la conexión sin forma de renovarse la próxima vez.
        refresh_token_encrypted: next.refreshToken
          ? encrypt(next.refreshToken)
          : row.refresh_token_encrypted,
        expires_at: next.expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('provider', 'mercadopago')
    return next.accessToken
  } catch {
    // El refresco falló (revocaron el permiso, cambió el secreto). Se
    // devuelve el token actual: puede seguir siendo válido, y si no lo es
    // el error aparece donde se usa, con contexto.
    return token
  }
}
