/**
 * Qué puede tocar el Operator.
 *
 * No es todo el catálogo, y la única exclusión que queda es deliberada:
 * `mensajes.enviar` le escribe a un cliente real del comercio, y esa
 * conversación la tiene que abrir una persona desde la bandeja, no un agente
 * que está diagnosticando la cuenta. Entra cuando exista el permiso por acción
 * que lo gobierne.
 *
 * Todo lo demás del catálogo entra. Esta lista se escribía a mano y se quedó
 * atrás dos veces seguidas: seis capacidades de contactos y segmentos y dos de
 * agentes llegaron al catálogo, con sus pruebas, y nadie se acordó de sumarlas
 * acá — la pantalla del chat hasta tenía las etiquetas de esos pasos esperando.
 * El síntoma no era un error sino algo peor: el chat contestaba "no puedo hacer
 * eso" sobre algo que estaba construido y probado.
 *
 * Por eso la lista se dio vuelta: en vez de enumerar lo que ENTRA, se enumera
 * lo que queda AFUERA. Una capacidad nueva le llega al chat el día que se
 * escribe, y sacarla del alcance del chat pasa a ser una decisión explícita que
 * se escribe acá con su motivo.
 */
import { ALL_CAPABILITIES } from '@/lib/capabilities/registry'
import type { Capability } from '@/lib/capabilities/types'

/**
 * Lo que el Operator NO puede tocar, con el motivo al lado.
 *
 * Ojo: esto no reemplaza a `esInerte`. Esa regla decide si algo se construye
 * solo o pide un click; ésta decide si el chat siquiera lo tiene a mano. Una
 * capacidad puede estar habilitada y aun así pedir aprobación siempre.
 */
const FUERA_DE_ALCANCE = new Map<string, string>([
  [
    'mensajes.enviar',
    'le escribe a un cliente real: esa conversación la abre una persona desde la bandeja',
  ],
])

export const OPERATOR_CAPABILITIES: Capability[] = ALL_CAPABILITIES.filter(
  (c) => !FUERA_DE_ALCANCE.has(c.key),
)

export function operatorCanUse(key: string): boolean {
  if (FUERA_DE_ALCANCE.has(key)) return false
  return ALL_CAPABILITIES.some((c) => c.key === key)
}

/** Por qué el chat no puede usar algo, cuando no puede. Para los mensajes de error. */
export function motivoFueraDeAlcance(key: string): string | null {
  return FUERA_DE_ALCANCE.get(key) ?? null
}
