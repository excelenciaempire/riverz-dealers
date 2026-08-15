import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Cuentas suspendidas.
 *
 * Riverz se cobra por fuera de la aplicación: el equipo activa y desactiva
 * a mano y factura aparte. Este módulo es lo único que hace que
 * "desactivar" signifique algo — sin él, una cuenta dada de baja seguía
 * usando el producto igual.
 *
 * Dos efectos, y ninguno más:
 *
 *  1. El comercio no entra al panel (lo atiende el layout del dashboard).
 *  2. **No sale ni un mensaje más a sus clientes.** Es el importante: una
 *     cuenta suspendida que sigue contestando DMs y mandando recuperación
 *     de carritos le está dando el servicio igual, y encima gasta la clave
 *     de IA y el cupo de WhatsApp de la plataforma.
 *
 * Lo que NO hace: borrar nada, cerrar sesiones abiertas, ni frenar la
 * ingesta. Los pedidos y mensajes que lleguen se siguen guardando, así que
 * cuando la cuenta se reactiva no hay un agujero en su historial.
 */

/** ¿Está suspendida esta cuenta? Fail-open: ante un error de lectura, NO se corta. */
export async function isWorkspaceSuspended(
  db: SupabaseClient,
  workspaceId: string | null | undefined,
): Promise<boolean> {
  if (!workspaceId) return false
  try {
    const { data } = await db
      .from('workspaces')
      .select('suspended_at')
      .eq('id', workspaceId)
      .maybeSingle()
    return Boolean((data as { suspended_at?: string | null } | null)?.suspended_at)
  } catch {
    // Un fallo de red no puede dejar mudo a un comercio que sí paga.
    return false
  }
}
