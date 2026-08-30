import type { SupabaseClient } from '@supabase/supabase-js'
import { completeTextConUso, hasLlm, type CompleteTextOptions } from './llm-client'
import { costForModel } from '@/lib/admin/cost'
import { resolveAnthropicKey } from './platform-key'
import { puedeUsarIa } from '@/lib/wallet/puerta'
import { cobrar } from '@/lib/wallet/saldo'

/**
 * Una llamada al modelo que SE COBRA y que no corre sin saldo.
 *
 * El runner y el compositor de comentarios pasan por la puerta y por la caja;
 * las llamadas auxiliares —clasificar si hay que escalar, puntuar un lead,
 * decidir si conviene abrir el privado, redactar el DM de respaldo, enriquecer
 * un perfil— no pasaban por ninguna de las dos. Cada una gasta con la llave de
 * Riverz y ninguna descuenta un centavo.
 *
 * La más cara de las tres cosas que eso rompía no es la plata: el clasificador
 * de escalado leía la clave del entorno directo, así que el triaje de un
 * comercio que trae SU PROPIA clave corría con la de Riverz. Acá la clave se
 * resuelve como en todos lados —la del agente, la de plataforma, el entorno— y
 * sólo se cobra cuando NO es la del comercio, porque a ese ya le cobra
 * Anthropic.
 *
 * Se cobra EL COSTO, no una tarifa: lo que el proveedor le cobró a Riverz por
 * esa llamada, calculado sobre los tokens que devolvió —con la caché aparte,
 * que se paga a otro precio—. Es el mismo criterio que la respuesta del runner.
 *
 * Devuelve `null` en vez de lanzar: sin saldo, sin clave o con el modelo caído,
 * quien llama ya tiene su camino de respaldo y no puede romperse por esto.
 */
export async function completeTextMedido(
  db: SupabaseClient,
  args: Omit<CompleteTextOptions, 'anthropicKey'> & {
    workspaceId: string
    /** La clave del agente, si la trae. */
    agentKeyEncrypted?: string | null
    concepto: 'ia_clasificacion' | 'ia_resumen' | 'ia_seguimiento' | 'ia_asistencia'
    referenciaTipo?: string
    referenciaId?: string | null
    detalle?: Record<string, unknown>
  },
): Promise<string | null> {
  const { workspaceId, agentKeyEncrypted, concepto, referenciaTipo, referenciaId, detalle, ...opts } =
    args

  if (!(await puedeUsarIa(db, workspaceId))) return null

  const resuelta = await resolveAnthropicKey(db, { workspaceId, agentKeyEncrypted })
  if (!resuelta || !hasLlm(resuelta.key)) return null

  let salida: Awaited<ReturnType<typeof completeTextConUso>>
  try {
    salida = await completeTextConUso({ ...opts, anthropicKey: resuelta.key })
  } catch {
    return null
  }

  // Se cobra lo que se pensó, aunque quien llama después descarte el texto: el
  // gasto ya ocurrió. Al que trae su propia clave le cobra Anthropic.
  if (resuelta.source !== 'agent') {
    void cobrar(db, workspaceId, {
      concepto,
      cantidad: 1,
      costoUsd: costForModel(salida.modelo, salida.uso.prompt, salida.uso.salida, {
        read: salida.uso.cacheLeida,
        write: salida.uso.cacheEscrita,
      }),
      referenciaTipo,
      referenciaId: referenciaId ?? null,
      detalle: { ...detalle, modelo: salida.modelo, proveedor: salida.proveedor },
    })
  }

  return salida.text
}
