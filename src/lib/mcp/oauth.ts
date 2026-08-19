import { createHash, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { generateToken, hashToken, tokenPrefix, type McpScope } from './tokens'

/**
 * OAuth para el MCP.
 *
 * Riverz es a la vez el servidor de recursos y el de autorización. Suena a
 * mucho; es lo mínimo que pide el spec de MCP para que un conector pueda
 * descubrir el servidor solo, registrarse y mandar a la persona a decir que sí.
 *
 * La decisión que ordena todo lo demás: **un token de OAuth es una fila de
 * `mcp_tokens`**, igual que uno pegado a mano, sólo que con vencimiento y con
 * el cliente que lo pidió. Así hay una sola resolución (`resolveActor`), un solo
 * modelo de alcance y una sola auditoría. La alternativa —dos caminos
 * paralelos— es la que garantiza que dentro de seis meses uno de los dos tenga
 * un agujero que el otro no.
 *
 * PKCE es obligatorio y no hay secreto de cliente: los clientes se registran
 * solos, así que el `client_id` no prueba nada. Lo que prueba que quien canjea
 * el código es el mismo que lo pidió es el `code_verifier`.
 */

/** Una hora. Corta a propósito: si se filtra, la ventana es corta. */
export const ACCESS_TTL_MS = 60 * 60 * 1000
/** Un minuto. El código sólo tiene que sobrevivir a un redirect. */
const CODE_TTL_MS = 60 * 1000

/** Los alcances que entendemos, en el vocabulario de OAuth. */
export const SCOPES = ['mcp:read', 'mcp:write'] as const

/**
 * De los scopes de OAuth al alcance interno.
 *
 * Pedir sólo `mcp:read` da una llave que no puede cambiar nada — lo mismo que
 * elegir "sólo lectura" en Ajustes. Sin scope declarado se da el más chico:
 * un cliente que no dijo qué necesita no necesita escribir.
 */
export function scopeInterno(scope: string | null | undefined): McpScope {
  return (scope ?? '').split(/\s+/).includes('mcp:write') ? 'total' : 'lectura'
}

export function scopeConcedido(interno: McpScope): string {
  return interno === 'total' ? 'mcp:read mcp:write' : 'mcp:read'
}

/** La URL pública de esta instalación, sin barra final. */
export function issuer(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://riverz.co').replace(/\/$/, '')
}

/** El recurso protegido: exactamente la URL del MCP. */
export function resourceUrl(): string {
  return `${issuer()}/api/mcp`
}

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex')
}

/** Verificación de PKCE. Sólo S256 — `plain` no protege de nada. */
export function pkceOk(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false
  const calculado = createHash('sha256').update(verifier).digest('base64url')
  return calculado === challenge
}

/**
 * ¿Este `redirect_uri` es uno de los que el cliente registró?
 *
 * Comparación exacta, sin prefijos ni comodines: aceptar "empieza con" es
 * exactamente cómo se roban códigos de autorización.
 */
export function redirectPermitido(registradas: string[], pedida: string): boolean {
  return registradas.includes(pedida)
}

// ────────────────────────────────────────────────────────────────
// Registro de clientes
// ────────────────────────────────────────────────────────────────

export interface ClienteRegistrado {
  client_id: string
  name: string
  redirect_uris: string[]
}

export async function registrarCliente(
  db: SupabaseClient,
  input: { name: string; redirect_uris: string[] },
): Promise<ClienteRegistrado> {
  const client_id = 'mcpc_' + randomBytes(16).toString('hex')
  const { error } = await db.from('oauth_clients').insert({
    client_id,
    name: input.name.slice(0, 120),
    redirect_uris: input.redirect_uris,
  })
  if (error) throw new Error(error.message)
  return { client_id, name: input.name, redirect_uris: input.redirect_uris }
}

export async function buscarCliente(
  db: SupabaseClient,
  clientId: string,
): Promise<ClienteRegistrado | null> {
  const { data } = await db
    .from('oauth_clients')
    .select('client_id, name, redirect_uris')
    .eq('client_id', clientId)
    .maybeSingle()
  return (data as ClienteRegistrado | null) ?? null
}

// ────────────────────────────────────────────────────────────────
// Código de autorización
// ────────────────────────────────────────────────────────────────

export async function emitirCodigo(
  db: SupabaseClient,
  input: {
    clientId: string
    workspaceId: string
    userId: string
    scope: string
    redirectUri: string
    codeChallenge: string
  },
): Promise<string> {
  const code = randomBytes(32).toString('base64url')
  const { error } = await db.from('oauth_codes').insert({
    code_hash: sha256(code),
    client_id: input.clientId,
    workspace_id: input.workspaceId,
    user_id: input.userId,
    scope: input.scope,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  if (error) throw new Error(error.message)
  return code
}

export interface CodigoCanjeado {
  workspaceId: string
  userId: string
  scope: string
  redirectUri: string
  codeChallenge: string
}

/**
 * Canjea el código, de una sola vez.
 *
 * El `update ... is('used_at', null)` es lo que hace que sea una sola: dos
 * canjes simultáneos, sólo uno encuentra fila. Devuelve `null` tanto si el
 * código no existe como si ya se usó — para quien pregunta desde afuera son la
 * misma respuesta, y tiene que serlo.
 */
export async function canjearCodigo(
  db: SupabaseClient,
  code: string,
): Promise<CodigoCanjeado | null> {
  const { data } = await db
    .from('oauth_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('code_hash', sha256(code))
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('workspace_id, user_id, scope, redirect_uri, code_challenge')
    .maybeSingle()

  const row = data as {
    workspace_id: string
    user_id: string
    scope: string
    redirect_uri: string
    code_challenge: string
  } | null
  if (!row) return null
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    scope: row.scope,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
  }
}

// ────────────────────────────────────────────────────────────────
// Tokens
// ────────────────────────────────────────────────────────────────

export interface ParDeTokens {
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string
}

/**
 * Emite el par de tokens.
 *
 * El access token entra en `mcp_tokens` porque es lo que después resuelve
 * `resolveActor`: para el servidor MCP no hay diferencia entre una llave pegada
 * a mano y una emitida por OAuth, y esa es toda la gracia.
 */
export async function emitirTokens(
  db: SupabaseClient,
  input: {
    clientId: string
    clientName: string
    workspaceId: string
    userId: string
    scope: string
  },
): Promise<ParDeTokens> {
  const interno = scopeInterno(input.scope)
  const access = generateToken()
  const refresh = generateToken()
  const expira = new Date(Date.now() + ACCESS_TTL_MS)

  const { error: e1 } = await db.from('mcp_tokens').insert({
    workspace_id: input.workspaceId,
    name: input.clientName,
    token_hash: hashToken(access),
    prefix: tokenPrefix(access),
    scope: interno,
    origin: 'oauth',
    client_id: input.clientId,
    created_by: input.userId,
    expires_at: expira.toISOString(),
  })
  if (e1) throw new Error(e1.message)

  const { error: e2 } = await db.from('oauth_refresh_tokens').insert({
    token_hash: hashToken(refresh),
    client_id: input.clientId,
    workspace_id: input.workspaceId,
    user_id: input.userId,
    scope: scopeConcedido(interno),
  })
  if (e2) throw new Error(e2.message)

  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    scope: scopeConcedido(interno),
  }
}

/**
 * Corta los refresh de un cliente en una cuenta.
 *
 * Hace falta al revocar una llave emitida por OAuth. El access token vive una
 * hora, así que revocar sólo su fila de `mcp_tokens` no revoca nada: el cliente
 * usa el refresh y se emite otra. Quien revoca desde la pantalla cree haber
 * cerrado la puerta y la dejó abierta.
 */
export async function revocarRefreshDeCliente(
  db: SupabaseClient,
  input: { clientId: string; workspaceId: string },
): Promise<void> {
  await db
    .from('oauth_refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('client_id', input.clientId)
    .eq('workspace_id', input.workspaceId)
    .is('revoked_at', null)
}

export interface RefreshValido {
  workspaceId: string
  userId: string
  scope: string
  clientId: string
}

export async function usarRefresh(
  db: SupabaseClient,
  refresh: string,
  clientId: string,
): Promise<RefreshValido | null> {
  const { data } = await db
    .from('oauth_refresh_tokens')
    .select('client_id, workspace_id, user_id, scope')
    .eq('token_hash', hashToken(refresh))
    .is('revoked_at', null)
    .maybeSingle()

  const row = data as {
    client_id: string
    workspace_id: string
    user_id: string
    scope: string
  } | null
  // El refresh de un cliente no sirve en otro, aunque el valor sea correcto.
  if (!row || row.client_id !== clientId) return null

  void db
    .from('oauth_refresh_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token_hash', hashToken(refresh))
    .then(() => undefined)

  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    scope: row.scope,
    clientId: row.client_id,
  }
}
