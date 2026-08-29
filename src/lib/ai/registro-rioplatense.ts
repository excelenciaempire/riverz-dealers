import type { SupabaseClient } from '@supabase/supabase-js'
import type { Contact } from '@/types'
import { countryOfPhone } from '@/lib/whatsapp/phone-utils'

/**
 * Registro rioplatense para los canales de TEXTO.
 *
 * La casa escribe en español neutro de tú, y eso no cambia: es lo que hace que
 * un comercio colombiano o mexicano no le hable de "vos" a su cliente. Pero un
 * comercio argentino escribiéndole a un cliente argentino en neutro suena a
 * traducción: nadie en Buenos Aires escribe "¿tienes alguna duda?" por
 * WhatsApp. Así que el registro se decide por el CLIENTE, con dato, no por una
 * preferencia global.
 *
 * **Deliberadamente más sobrio que el de voz** (`voice/constants.ts`
 * `RIOPLATENSE_SPEECH`). Por teléfono las muletillas suenan naturales; escritas
 * se leen como una imitación. Acá va el voseo y nada más: sin "che", sin
 * "bárbaro", sin "quilombo". Que se lea como lo escribiría una persona del
 * negocio, no como un personaje.
 *
 * Vive en su propio archivo y no dentro de `ai/runner.ts` a propósito: el
 * prompt del agente se revisa contra `ai/sin-voseo.test.ts`, que prohíbe las
 * formas de voseo en el camino del agente justamente para que no se filtren
 * cuando el comercio NO es argentino. Este bloque es la variante deliberada,
 * igual que `lib/voice/**`, y por eso queda fuera de esa lista.
 */
export const RIOPLATENSE_TEXTO = [
  'La persona del otro lado es de Argentina: escribile como se escribe allá, de vos.',
  'Voseo natural: "tenés", "querés", "podés", "necesitás", "decime", "mirá", "fijate", "dale". Nunca "tú", "tienes", "quieres", "puedes".',
  'Sin exagerar: es el trato de todos los días, no un personaje. Nada de "che", "boludo" ni jerga fuerte.',
  'Vocabulario de allá cuando corresponda: "plata" antes que "dinero", "celular" antes que "móvil".',
  'Un solo trato en toda la conversación: si arrancaste de vos, seguís de vos.',
].join('\n')

/** El trato con el que escribe el agente. */
export type Registro = 'neutro' | 'rioplatense'

/** Los países donde se escribe de vos. */
const RIOPLATENSES = new Set(['AR', 'UY', 'ARGENTINA', 'URUGUAY'])

/**
 * ¿Este país es rioplatense? `null` = no hay dato.
 *
 * Acepta el código y el nombre porque llegan los dos: Shopify manda
 * `country_code` ("AR") en unos endpoints y `country` ("Argentina") en otros, y
 * el tipo de la ficha sólo declara el segundo. Un nombre que no está en la
 * lista es un `false` legítimo —la persona dijo de dónde es y no es de acá—,
 * no un "no sé": por eso no hace falta una tabla de todos los países.
 */
function esRioplatense(raw: string | null | undefined): boolean | null {
  const s = (raw ?? '').trim().toUpperCase()
  if (!s) return null
  return RIOPLATENSES.has(s)
}

/**
 * ¿El cliente de esta conversación escribe de vos?
 *
 * En orden de confianza, y el primero que tenga dato gana:
 *
 *   1. La dirección del cliente en la tienda. Es el único dato que sirve en
 *      TODOS los canales —Instagram, comentarios, chat web y correo no tienen
 *      teléfono— y es el que la persona escribió ella misma.
 *   2. El teléfono del contacto. En WhatsApp es el propio `external_id`.
 *   3. El país del número de WhatsApp del COMERCIO. Es una inferencia, no un
 *      dato del cliente, y va última por eso; pero un comercio argentino le
 *      vende sobre todo a argentinos, y sin esto Instagram y el chat web —donde
 *      no hay teléfono ni pedido— se quedarían siempre en neutro.
 */
async function clienteRioplatense(input: {
  db: SupabaseClient
  workspaceId: string
  contact: Contact
  primaryContact?: Contact | null
  /** `default_address.country_code` o `.country` del cliente en la tienda. */
  paisEnLaTienda?: string | null
}): Promise<boolean> {
  const enLaTienda = esRioplatense(input.paisEnLaTienda)
  if (enLaTienda !== null) return enLaTienda

  for (const c of [input.contact, input.primaryContact]) {
    if (!c) continue
    const tel =
      c.phone ?? (c.channel === 'whatsapp' ? c.external_id : null) ?? null
    const porTelefono = esRioplatense(countryOfPhone(tel))
    if (porTelefono !== null) return porTelefono
  }

  const { data } = await input.db
    .from('channel_connections')
    .select('config')
    .eq('workspace_id', input.workspaceId)
    .eq('channel', 'whatsapp')
    .eq('status', 'connected')
    .limit(1)
    .maybeSingle()
  const display = (data as { config?: { display_phone_number?: string } } | null)
    ?.config?.display_phone_number
  return esRioplatense(countryOfPhone(display)) === true
}

/**
 * Qué trato le corresponde a esta conversación.
 *
 * Sólo en español: un agente en inglés o portugués no tiene voseo que elegir.
 * Fail-soft — ante cualquier error se vuelve a neutro, que es lo que se
 * entiende en todos lados.
 */
export async function resolverRegistro(input: {
  db: SupabaseClient
  workspaceId: string
  /** `ai_agents.language`. */
  idioma?: string | null
  contact: Contact
  primaryContact?: Contact | null
  paisEnLaTienda?: string | null
}): Promise<Registro> {
  if ((input.idioma || 'es').toLowerCase().slice(0, 2) !== 'es') return 'neutro'
  try {
    // Argentina y Uruguay comparten el rioplatense. Paraguay también vosea,
    // pero con otro registro: se deja afuera hasta tener a quién preguntarle.
    return (await clienteRioplatense(input)) ? 'rioplatense' : 'neutro'
  } catch {
    return 'neutro'
  }
}
