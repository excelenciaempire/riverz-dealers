/**
 * Un turno con vida propia.
 *
 * El trabajo del Operador vivía dentro del stream de la respuesta: si el
 * navegador se iba —cambiar de pantalla, cerrar la pestaña, perder señal— el
 * stream se cortaba y con él el turno. Al volver, la conversación mostraba el
 * pedido y ninguna respuesta, como si nunca hubiera pasado nada. Y un turno con
 * reparto tarda minutos: irse a mirar otra cosa mientras tanto es lo normal.
 *
 * Ahora empieza cuando alguien pide algo y termina cuando termina, mire alguien
 * o no. La fila de `operator_runs` es dónde vive mientras tanto, y de ahí sale
 * lo que ve quien vuelve.
 *
 * El latido guarda la MISMA foto que se guarda con el mensaje terminado —texto
 * y bloques— así que no hay una segunda forma de los datos que pueda quedar
 * desincronizada de la primera.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Bloque } from './bloques'

export type EstadoCorrida = 'corriendo' | 'listo' | 'fallido' | 'detenido'

export interface Corrida {
  id: string
  threadId: string
  estado: EstadoCorrida
  cancelar: boolean
  texto: string
  bloques: Bloque[]
  error: string | null
  empezoEn: string
}

/** Cada cuánto se guarda la foto. Un latido por segundo alcanza para mirar. */
const LATIDO_MS = 1000

/**
 * Cuándo se da por muerta una corrida sin latido.
 *
 * El proceso puede caerse en medio de un turno —un deploy, un reinicio— y esa
 * fila quedaría «corriendo» para siempre, bloqueando el hilo por el índice
 * único. Si hace dos minutos que no late, no está corriendo.
 */
const MUERTA_MS = 2 * 60 * 1000

const COLUMNAS = 'id, thread_id, estado, cancelar, texto, bloques, error, started_at'

interface Fila {
  id: string
  thread_id: string
  estado: EstadoCorrida
  cancelar: boolean
  texto: string
  bloques: unknown
  error: string | null
  started_at: string
}

function aCorrida(f: Fila): Corrida {
  return {
    id: f.id,
    threadId: f.thread_id,
    estado: f.estado,
    cancelar: f.cancelar === true,
    texto: f.texto ?? '',
    bloques: Array.isArray(f.bloques) ? (f.bloques as Bloque[]) : [],
    error: f.error,
    empezoEn: f.started_at,
  }
}

/** La corrida viva de un hilo, si la hay y si de verdad está viva. */
export async function corridaViva(
  db: SupabaseClient,
  threadId: string,
  workspaceId: string,
): Promise<Corrida | null> {
  const { data } = await db
    .from('operator_runs')
    .select(`${COLUMNAS}, updated_at`)
    .eq('thread_id', threadId)
    .eq('workspace_id', workspaceId)
    .eq('estado', 'corriendo')
    .maybeSingle()
  const f = data as (Fila & { updated_at: string }) | null
  if (!f) return null

  // Sin latido reciente, el proceso que la corría ya no está. Se cierra para
  // que el hilo no quede trabado por el índice único.
  if (Date.now() - Date.parse(f.updated_at) > MUERTA_MS) {
    await db
      .from('operator_runs')
      .update({ estado: 'fallido', error: 'se cortó', finished_at: new Date().toISOString() })
      .eq('id', f.id)
    return null
  }
  return aCorrida(f)
}

export async function leerCorrida(
  db: SupabaseClient,
  id: string,
  workspaceId: string,
): Promise<Corrida | null> {
  const { data } = await db
    .from('operator_runs')
    .select(COLUMNAS)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  return data ? aCorrida(data as Fila) : null
}

/**
 * Abre una corrida para este hilo.
 *
 * Si ya hay una viva la devuelve en vez de crear otra: dos turnos a la vez
 * sobre la misma conversación se pisan el contexto, y el índice único lo
 * rechazaría de todos modos.
 */
export async function abrirCorrida(
  db: SupabaseClient,
  threadId: string,
  workspaceId: string,
): Promise<{ id: string; yaHabia: boolean }> {
  const viva = await corridaViva(db, threadId, workspaceId)
  if (viva) return { id: viva.id, yaHabia: true }

  const { data, error } = await db
    .from('operator_runs')
    .insert({ thread_id: threadId, workspace_id: workspaceId, estado: 'corriendo' })
    .select('id')
    .single()

  /**
   * Dos envíos a la vez: gana el índice único, no una excepción.
   *
   * Entre mirar si hay una viva e insertar la nueva hay un hueco, y dos clicks
   * seguidos caen los dos adentro. El índice parcial rechaza al segundo, y eso
   * salía como un 500 con el mensaje de Postgres en pantalla. Es exactamente el
   * caso que el 409 ya sabe atender: hay una corriendo, mírala.
   */
  if (error) {
    const otra = await corridaViva(db, threadId, workspaceId)
    if (otra) return { id: otra.id, yaHabia: true }
    throw new Error(error.message)
  }
  return { id: (data as { id: string }).id, yaHabia: false }
}

/**
 * El latido: guarda cómo va, sin ahogar la base.
 *
 * Escribe como mucho una vez por segundo. Un turno con reparto emite cientos de
 * eventos y guardar en cada uno sería una escritura por delta de texto.
 */
export function latido(db: SupabaseClient, runId: string) {
  let ultimo = 0
  let guardando: Promise<unknown> | null = null

  return {
    async ver(texto: string, bloques: Bloque[], forzar = false) {
      const ahora = Date.now()
      if (!forzar && (ahora - ultimo < LATIDO_MS || guardando)) return
      ultimo = ahora
      // Un latido que falla no puede tumbar el turno: es la foto, no el
      // trabajo. Lo peor que pasa es que quien vuelve la vea un segundo vieja.
      guardando = Promise.resolve(
        db
          .from('operator_runs')
          .update({ texto, bloques, updated_at: new Date().toISOString() })
          .eq('id', runId),
      )
        .catch(() => undefined)
        .then(() => {
          guardando = null
        })
      if (forzar) await guardando
    },
  }
}

/** ¿Alguien pidió detenerla? Se mira entre vueltas, no a mitad de una. */
export async function pidieronDetener(
  db: SupabaseClient,
  runId: string,
): Promise<boolean> {
  const { data } = await db
    .from('operator_runs')
    .select('cancelar')
    .eq('id', runId)
    .maybeSingle()
  return (data as { cancelar?: boolean } | null)?.cancelar === true
}

export async function pedirDetener(
  db: SupabaseClient,
  runId: string,
  workspaceId: string,
): Promise<void> {
  await db
    .from('operator_runs')
    .update({ cancelar: true, updated_at: new Date().toISOString() })
    .eq('id', runId)
    .eq('workspace_id', workspaceId)
    .eq('estado', 'corriendo')
}

export async function cerrarCorrida(
  db: SupabaseClient,
  runId: string,
  estado: Exclude<EstadoCorrida, 'corriendo'>,
  extra?: { texto?: string; bloques?: Bloque[]; error?: string },
): Promise<void> {
  await db
    .from('operator_runs')
    .update({
      estado,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(extra?.texto !== undefined ? { texto: extra.texto } : {}),
      ...(extra?.bloques !== undefined ? { bloques: extra.bloques } : {}),
      ...(extra?.error !== undefined ? { error: extra.error } : {}),
    })
    .eq('id', runId)
}
