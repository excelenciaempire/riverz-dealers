import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { publicBaseUrl } from '@/lib/base-url'
import { legacyMercadoLibreApp, mercadoLibreApp } from '@/lib/channels/mercadolibre/apps'

/**
 * OAuth de Mercado Pago: conectar con un clic.
 *
 * Usa su propia aplicación: desde el 30 de agosto de 2026 Mercado Libre exige
 * una aplicación por unidad, y la de Mercado Libre que tenga permisos de
 * Mercado Pago pierde acceso a su API. Sin `MERCADOPAGO_CLIENT_ID` queda el
 * camino de pegar el Access Token.
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
  return process.env.MERCADOPAGO_CLIENT_ID || ''
}

function clientSecret(): string {
  return process.env.MERCADOPAGO_CLIENT_SECRET || ''
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

/**
 * PKCE. Mercado Pago lo exige: sin `code_verifier`, el canje del código
 * responde 400 `code_verifier is a required parameter` y la conexión no se
 * completa nunca.
 *
 * El secreto se arma al empezar, viaja sólo su hash hasta Mercado Pago y se
 * guarda en una cookie del navegador hasta la vuelta. Así, un código robado
 * en el camino no alcanza para canjear nada: falta el original.
 */
export const PKCE_COOKIE = 'mp_oauth_pkce'

export function newVerifier(): string {
  return randomBytes(32).toString('base64url')
}

export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function authorizeUrl(workspaceId: string, verifier: string): string {
  const qs = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    platform_id: 'mp',
    state: signState(workspaceId),
    redirect_uri: redirectUri(),
    code_challenge: challengeFor(verifier),
    code_challenge_method: 'S256',
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

export function exchangeCode(code: string, verifier: string): Promise<MpTokens> {
  return postToken({
    client_id: clientId(),
    client_secret: clientSecret(),
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  })
}

/**
 * Un refresh sólo se canjea con la aplicación que lo emitió, y la integración
 * no guarda cuál fue. Las autorizadas antes de la separación usaron una de
 * Mercado Libre y se renuevan con ella. La de Mercado Pago va primero, así sus
 * tokens nunca pasan por las otras.
 */
function refreshApps(): Array<{ id: string; secret: string }> {
  const apps: Array<{ id: string; secret: string }> = []
  const candidates = [
    { clientId: clientId(), clientSecret: clientSecret() },
    mercadoLibreApp(),
    legacyMercadoLibreApp(),
  ]
  for (const app of candidates) {
    if (!app?.clientId || !app.clientSecret || apps.some((a) => a.id === app.clientId)) continue
    apps.push({ id: app.clientId, secret: app.clientSecret })
  }
  return apps
}

export async function refreshTokens(refreshToken: string): Promise<MpTokens> {
  let firstError: unknown
  for (const app of refreshApps()) {
    try {
      return await postToken({
        client_id: app.id,
        client_secret: app.secret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })
    } catch (err) {
      firstError ??= err
    }
  }
  throw firstError ?? new Error('mercadopago oauth: no app configured')
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
        renew_failed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('provider', 'mercadopago')
    return next.accessToken
  } catch {
    // El refresco falló: le revocaron el permiso a la aplicación, o cambió
    // el secreto. Se deja la marca para que Integraciones pueda decirlo —
    // sin ella la pantalla sólo ve una fecha de vencimiento y no sabe si el
    // sistema está renovando bien o viene fallando hace días.
    await admin
      .from('workspace_integrations')
      .update({ renew_failed_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('provider', 'mercadopago')
    // Se devuelve el token actual igual: puede seguir siendo válido un rato
    // más, y mientras tanto la recuperación no se corta de golpe.
    return token
  }
}
