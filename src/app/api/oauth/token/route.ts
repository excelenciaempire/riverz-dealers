import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { limitByKey, rateLimitResponse, clientIp } from '@/lib/rate-limit'
import {
  buscarCliente,
  canjearCodigo,
  emitirTokens,
  pkceOk,
  usarRefresh,
  resourceUrl,
} from '@/lib/mcp/oauth'
import { userAccess } from '@/lib/mcp/access'

export const dynamic = 'force-dynamic'

/**
 * Canje de código por token, y renovación.
 *
 * Sin secreto de cliente: quien prueba que tiene derecho a este código es el
 * `code_verifier`, no una credencial guardada en la máquina del usuario. Es lo
 * correcto para clientes públicos y es lo que dice el spec de MCP.
 *
 * Las respuestas de error siguen el formato de OAuth (`error`,
 * `error_description`) porque los clientes las parsean: devolver un JSON propio
 * los deja sin saber si reintentar, re-autorizar o rendirse.
 */
const RATE = { limit: 60, windowMs: 60_000 }

function malaPeticion(error: string, description?: string, status = 400) {
  return NextResponse.json(
    { error, ...(description ? { error_description: description } : {}) },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

/** Acepta form-urlencoded (lo normal en OAuth) y JSON, por si acaso. */
async function leerCuerpo(request: Request): Promise<Record<string, string>> {
  const tipo = request.headers.get('content-type') ?? ''
  if (tipo.includes('application/json')) {
    const j = (await request.json().catch(() => ({}))) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(j).map(([k, v]) => [k, typeof v === 'string' ? v : String(v ?? '')]),
    )
  }
  const form = await request.formData().catch(() => null)
  if (!form) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of form.entries()) out[k] = typeof v === 'string' ? v : ''
  return out
}

export async function POST(request: Request) {
  try { return await exchange(request) }
  catch { return malaPeticion('temporarily_unavailable', undefined, 503) }
}

async function exchange(request: Request) {
  const rl = await limitByKey(`oauth-token:${clientIp(request)}`, RATE)
  if (!rl.success) return rateLimitResponse(rl)

  const body = await leerCuerpo(request)
  if (body.resource && body.resource !== resourceUrl()) return malaPeticion('invalid_target')
  const db = supabaseAdmin()
  const clientId = body.client_id ?? ''
  if (!clientId) return malaPeticion('invalid_request', 'falta client_id')

  const cliente = await buscarCliente(db, clientId)
  if (!cliente) return malaPeticion('invalid_client', 'ese cliente no está registrado', 401)

  // ── Renovación ──
  if (body.grant_type === 'refresh_token') {
    const valido = await usarRefresh(db, body.refresh_token ?? '', clientId)
    if (!valido) return malaPeticion('invalid_grant', 'refresh inválido o revocado')
    const access = await userAccess(db, valido.userId, valido.workspaceId)
    if (!access) return malaPeticion('invalid_grant')
    if (body.scope && body.scope.split(/\s+/).some(s => !valido.scope.split(/\s+/).includes(s))) return malaPeticion('invalid_scope')
    const tokens = await emitirTokens(db, {
      clientId,
      clientName: cliente.name,
      workspaceId: valido.workspaceId,
      userId: valido.userId,
      scope: access.admin ? body.scope || valido.scope : 'mcp:read' +
        ((body.scope || valido.scope).split(/\s+/).includes('offline_access') ? ' offline_access' : ''),
    })
    return NextResponse.json(
      { token_type: 'Bearer', ...tokens },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // ── Canje del código ──
  if (body.grant_type !== 'authorization_code') {
    return malaPeticion('unsupported_grant_type')
  }
  if (!body.code || !body.code_verifier) {
    return malaPeticion('invalid_request', 'faltan code o code_verifier')
  }

  const canje = await canjearCodigo(db, body.code, clientId)
  // Mismo mensaje para "no existe", "ya se usó" y "venció": distinguirlos le
  // diría a quien lo intenta cuál de las tres cosas acertó.
  if (!canje) return malaPeticion('invalid_grant', 'código inválido, vencido o ya usado')

  if (body.redirect_uri !== canje.redirectUri) {
    return malaPeticion('invalid_grant', 'la redirect_uri no coincide con la del código')
  }
  if (!pkceOk(body.code_verifier, canje.codeChallenge)) {
    return malaPeticion('invalid_grant', 'el code_verifier no corresponde')
  }
  const access = await userAccess(db, canje.userId, canje.workspaceId)
  if (!access) return malaPeticion('invalid_grant')

  const tokens = await emitirTokens(db, {
    clientId,
    clientName: cliente.name,
    workspaceId: canje.workspaceId,
    userId: canje.userId,
    scope: access.admin ? canje.scope : 'mcp:read' +
      (canje.scope.split(/\s+/).includes('offline_access') ? ' offline_access' : ''),
  })

  return NextResponse.json(
    { token_type: 'Bearer', ...tokens },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
