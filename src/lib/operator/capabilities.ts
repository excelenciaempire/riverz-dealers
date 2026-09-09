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
 * Lo que el Operator NO puede tocar. Hoy: nada.
 *
 * Durante un tiempo `mensajes.enviar` estuvo acá, con el argumento de que esa
 * conversación la abre una persona desde la bandeja. Se sacó, y el motivo es
 * que el argumento estaba mirando el lugar equivocado: **esta lista nunca fue
 * la barrera de seguridad**. La barrera es `esInerte`, y funciona distinto.
 *
 * Mandar un mensaje es `irreversible` y no es inerte, así que SIEMPRE deja una
 * fila esperando un click, en todos los modos y para todos. Excluirla de acá no
 * le sacaba un click a nada: sólo hacía que el chat contestara "eso no se puede
 * desde acá" en vez de ofrecerse a hacerlo con su vista previa y su botón.
 *
 * El mapa queda porque la puerta sigue existiendo. Sacar algo del alcance del
 * chat es una decisión legítima; lo que no vale es usarla como sustituto de
 * `esInerte`. Si algo entra acá, entra con su motivo escrito.
 */
const FUERA_DE_ALCANCE = new Map<string, string>()

export const OPERATOR_CAPABILITIES: Capability[] = ALL_CAPABILITIES.filter(
  (c) => !FUERA_DE_ALCANCE.has(c.key),
)

export function operatorCapabilitiesForWorkspace(workspaceId: string): Capability[] {
  return OPERATOR_CAPABILITIES.filter((c) => !c.workspaceIds || c.workspaceIds.includes(workspaceId))
}

export function operatorCanUse(key: string, workspaceId?: string): boolean {
  if (FUERA_DE_ALCANCE.has(key)) return false
  return ALL_CAPABILITIES.some((c) => c.key === key &&
    (workspaceId === undefined || !c.workspaceIds || c.workspaceIds.includes(workspaceId)))
}

/** Por qué el chat no puede usar algo, cuando no puede. Para los mensajes de error. */
export function motivoFueraDeAlcance(key: string): string | null {
  return FUERA_DE_ALCANCE.get(key) ?? null
}
