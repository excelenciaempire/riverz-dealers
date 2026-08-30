import type { SupabaseClient } from '@supabase/supabase-js'
import { completeText, hasLlm, type CompleteTextOptions } from './llm-client'
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
 * `completeText` sólo devuelve texto, sin uso de tokens, así que se cobra la
 * tarifa de lista del concepto y no el costo medido. Para estas llamadas la
 * tarifa está por encima del costo real (`ia_clasificacion`: 0,3 centavos de
 * tarifa contra 0,1 medido), así que el redondeo no juega en contra.
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
    concepto: 'ia_clasificacion' | 'ia_resumen' | 'ia_seguimiento'
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

  let texto: string
  try {
    texto = await completeText({ ...opts, anthropicKey: resuelta.key })
  } catch {
    return null
  }

  // Se cobra lo que se pensó, aunque quien llama después descarte el texto: el
  // gasto ya ocurrió. Al que trae su propia clave le cobra Anthropic.
  if (resuelta.source !== 'agent') {
    void cobrar(db, workspaceId, {
      concepto,
      cantidad: 1,
      referenciaTipo,
      referenciaId: referenciaId ?? null,
      detalle,
    })
  }

  return texto
}
