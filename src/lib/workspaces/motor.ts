import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * El motor de una cuenta: ¿puede salir algo hacia afuera?
 *
 * Hay dos formas de que la respuesta sea no, y significan cosas distintas:
 *
 *  - **Suspendida** (`suspended_at`, ver `lib/workspaces/suspension`): no paga.
 *    Además del silencio, se le cierra el panel.
 *  - **Motor apagado** (`motor_apagado_at`): la operación está armada pero
 *    todavía no la aprobó, o alguien la frenó. Silencio hacia afuera, pero el
 *    comercio entra al panel y ve todo — si no, no tendría dónde aprobarla.
 *
 * Para el que envía son lo mismo, y por eso esta función es una sola: cada
 * lugar que manda un mensaje, corre una automatización o marca un teléfono
 * pregunta acá y no en dos lados. Que sean dos columnas es asunto del panel,
 * no del que envía.
 *
 * Fail-open, igual que la suspensión: un fallo de red no puede dejar mudo a un
 * comercio que sí está andando.
 */
export async function motorApagado(
  db: SupabaseClient,
  workspaceId: string | null | undefined,
): Promise<boolean> {
  if (!workspaceId) return false
  try {
    const { data } = await db
      .from('workspaces')
      .select('suspended_at, motor_apagado_at')
      .eq('id', workspaceId)
      .maybeSingle()
    const f = data as {
      suspended_at?: string | null
      motor_apagado_at?: string | null
    } | null
    return Boolean(f?.suspended_at || f?.motor_apagado_at)
  } catch {
    return false
  }
}

/** Estado del motor, para las pantallas que muestran cuál de las dos es. */
export interface EstadoMotor {
  /** No sale nada: por cualquiera de las dos razones. */
  apagado: boolean
  /** Suspendida por cobro. Además, sin panel. */
  suspendida: boolean
  /** Frenada a la espera de aprobación. Con panel. */
  esperandoAprobacion: boolean
}

export async function estadoDelMotor(
  db: SupabaseClient,
  workspaceId: string | null | undefined,
): Promise<EstadoMotor> {
  const vacio = { apagado: false, suspendida: false, esperandoAprobacion: false }
  if (!workspaceId) return vacio
  try {
    const { data } = await db
      .from('workspaces')
      .select('suspended_at, motor_apagado_at')
      .eq('id', workspaceId)
      .maybeSingle()
    const f = data as {
      suspended_at?: string | null
      motor_apagado_at?: string | null
    } | null
    const suspendida = Boolean(f?.suspended_at)
    const esperandoAprobacion = Boolean(f?.motor_apagado_at)
    return {
      apagado: suspendida || esperandoAprobacion,
      suspendida,
      esperandoAprobacion,
    }
  } catch {
    return vacio
  }
}

/**
 * Prender o apagar el motor.
 *
 * No toca `suspended_at`: una cuenta suspendida que enciende el motor sigue
 * muda, y así tiene que ser — encender lo que el comercio aprobó no puede
 * saltearse el cobro.
 */
export async function ponerMotor(
  db: SupabaseClient,
  workspaceId: string,
  encendido: boolean,
  actorId: string | null,
): Promise<void> {
  const { error } = await db
    .from('workspaces')
    .update({
      motor_apagado_at: encendido ? null : new Date().toISOString(),
      motor_apagado_por: encendido ? null : actorId,
    })
    .eq('id', workspaceId)
  if (error) throw new Error(error.message)
}
