import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Las llaves del MCP.
 *
 * Hay dos clases y la diferencia importa:
 *
 *   plataforma — la del equipo de Riverz (`MCP_ADMIN_TOKEN`). Cruza cuentas a
 *                propósito: es la que contesta "¿a qué comercio se le rompió
 *                algo?". El workspace viaja como argumento.
 *   comercio   — la que crea un comercio para sí mismo. Acá el argumento NO se
 *                usa: el alcance sale de la llave. Es la única forma de que
 *                repartir llaves no sea repartir la plataforma entera.
 *
 * En la base vive el hash, nunca el token. El valor se muestra una sola vez, al
 * crearlo, como toda credencial que se respeta.
 */

export type McpActor =
  | { kind: 'platform'; label: string }
  | { kind: 'workspace'; workspaceId: string; tokenId: string; label: string }

const PREFIX = 'rvz_'

/** Token nuevo en claro. Sólo lo ve quien lo crea, y una sola vez. */
export function generateToken(): string {
  return PREFIX + randomBytes(30).toString('base64url')
}

/**
 * SHA-256 a secas y no bcrypt: esto se verifica en CADA llamada al MCP, y un
 * hash lento ahí es latencia en cada herramienta. La razón por la que alcanza
 * es que un token de 30 bytes aleatorios no se adivina por diccionario — el
 * costo de bcrypt protege contraseñas humanas, que es otro problema.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Los primeros caracteres, para poder distinguir una llave de otra en la lista. */
export function tokenPrefix(token: string): string {
  return token.slice(0, PREFIX.length + 6)
}

/** Compara sin filtrar el tiempo que tarda. */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}

/**
 * ¿De quién es esta llave?
 *
 * Primero la de plataforma; después las de comercio. Devuelve `null` cuando no
 * es de nadie — el que llama traduce eso a "clave inválida" sin decir por qué,
 * que es lo único que hay que contestarle a quien no tiene llave.
 */
export async function resolveActor(
  db: SupabaseClient,
  presented: string,
): Promise<McpActor | null> {
  if (!presented) return null

  const platform = process.env.MCP_ADMIN_TOKEN
  if (platform && sameSecret(presented, platform)) {
    return { kind: 'platform', label: 'plataforma' }
  }

  const { data } = await db
    .from('mcp_tokens')
    .select('id, workspace_id, name')
    .eq('token_hash', hashToken(presented))
    .is('revoked_at', null)
    .maybeSingle()

  const row = data as { id: string; workspace_id: string; name: string } | null
  if (!row) return null

  // "Cuándo se usó por última vez" es lo que permite revocar sin miedo: se ve
  // cuál está viva. No se espera —si falla, la llamada sigue— porque es
  // telemetría, no autorización.
  void db
    .from('mcp_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id)
    .then(() => undefined)

  return {
    kind: 'workspace',
    workspaceId: row.workspace_id,
    tokenId: row.id,
    label: row.name,
  }
}

/** Clave del limitador: la llave, no lo que diga el que llama. */
export function rateKey(actor: McpActor): string {
  return actor.kind === 'platform' ? 'mcp:platform' : `mcp:${actor.tokenId}`
}
