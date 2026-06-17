import { NextResponse } from 'next/server'

/**
 * Respuesta de error interno segura para el cliente.
 *
 * Loguea el error real en el servidor (para debugging/observabilidad) pero
 * devuelve un mensaje genérico. Evita filtrar al cliente detalles internos
 * de Supabase/Postgres (nombres de columnas, constraints, nombres de
 * políticas RLS, stack traces) que ayudarían a un atacante a mapear el
 * esquema o la lógica de negocio.
 *
 * Usar para errores 5xx inesperados (fallos de DB, excepciones). NO usar
 * para errores de validación 4xx, donde el mensaje explícito al usuario es
 * intencional y seguro.
 */
export function serverError(
  err: unknown,
  message = 'Error interno',
  status = 500,
): NextResponse {
  console.error('[api]', message, err)
  return NextResponse.json({ error: message }, { status })
}
