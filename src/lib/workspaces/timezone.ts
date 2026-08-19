import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_TIMEZONE } from '@/lib/timezones'

/**
 * La zona horaria en la que reporta una cuenta (migración 072).
 *
 * Importa más de lo que parece: es la que decide dónde corta el día. Un
 * comercio en Buenos Aires consultado desde Colombia tiene que ver SU "hoy",
 * no el de quien pregunta — si no, "hoy" empieza dos horas antes y las cifras
 * no cuadran con lo que muestra su panel.
 */
export async function workspaceTimezone(
  db: SupabaseClient,
  workspaceId: string,
): Promise<string> {
  const { data } = await db
    .from('workspaces')
    .select('timezone')
    .eq('id', workspaceId)
    .maybeSingle()
  return (data as { timezone?: string | null } | null)?.timezone || DEFAULT_TIMEZONE
}
