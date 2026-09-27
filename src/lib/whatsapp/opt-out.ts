import type { SupabaseClient } from '@supabase/supabase-js'

const OPT_OUT_KEYWORDS = ['STOP', 'BAJA', 'CANCELAR', 'UNSUBSCRIBE', 'CANCEL', 'SAIR']
const OPT_IN_KEYWORDS = ['SUSCRIBIR', 'SUBSCRIBE', 'ALTA', 'START']

/** Marcas diacríticas que deja `NFD` al descomponer las tildes y la ñ. */
const DIACRITICOS = /[̀-ͯ]/g

/**
 * Cortesías y muletillas que rodean a la palabra clave sin cambiar la
 * intención: "baja por favor", "hola, dar de baja", "quiero alta gracias".
 */
const RELLENO = new Set([
  'HOLA', 'BUEN', 'BUENOS', 'BUENAS', 'DIA', 'DIAS', 'TARDE', 'TARDES',
  'NOCHE', 'NOCHES', 'POR', 'FAVOR', 'PORFA', 'PORFAVOR', 'GRACIAS', 'QUIERO',
  'QUISIERA', 'DESEO', 'ME', 'DOY', 'DAR', 'DARME', 'DE', 'PLEASE', 'THANKS',
])

/**
 * Mayúsculas, sin tildes, sin signos ni emojis, palabras separadas por un
 * espacio. `¡Baja, por favor!` → `BAJA POR FAVOR`.
 */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * La palabra clave tiene que ser el mensaje ENTERO, no aparecer dentro de él.
 *
 * Buscarla en cualquier parte de la frase silenciaba a quien escribía "quiero
 * cancelar el envío" o "me dieron de baja en la obra social", y respondía un
 * acuse de suscripción a "Alta mancha en la ropa deja el serum" (caso real,
 * Instagram, 2026-08-29) en vez de contestar la consulta: el handler de
 * opt-in/opt-out corta el turno y la IA nunca llega a ver el mensaje.
 */
function matchesAny(text: string, words: string[]): boolean {
  const palabras = normalize(text).split(' ').filter(Boolean)
  const nucleo = palabras.filter((p) => !RELLENO.has(p))
  return nucleo.length === 1 && words.includes(nucleo[0])
}

export function isOptOutKeyword(text: string): boolean {
  return ['NO MAS RECORDATORIOS', 'STOP REMINDERS'].includes(normalize(text)) || matchesAny(text, OPT_OUT_KEYWORDS)
}

/** A declined recovery button is not the same as an arbitrary “no thanks” in chat. */
export function isRecoveryOptOutButton(workspaceId: string, text: string, messageType: string): boolean {
  return workspaceId === '234604a9-909b-4e50-952b-acde4a85593a' &&
    messageType === 'button' && normalize(text) === 'NO GRACIAS'
}

export function isOptInKeyword(text: string): boolean {
  return matchesAny(text, OPT_IN_KEYWORDS)
}

export async function markOptedOut(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
  reason: string,
): Promise<void> {
  await db
    .from('contacts')
    .update({
      opted_out: true,
      opted_out_at: new Date().toISOString(),
      opted_out_reason: reason,
    })
    .eq('id', contactId)
    .eq('workspace_id', workspaceId)
}

export async function markOptedIn(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<void> {
  await db
    .from('contacts')
    .update({
      opted_out: false,
      opted_out_at: null,
      opted_out_reason: null,
    })
    .eq('id', contactId)
    .eq('workspace_id', workspaceId)
}

export async function isOptedOut(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<boolean> {
  const { data } = await db
    .from('contacts')
    .select('opted_out')
    .eq('id', contactId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  return Boolean((data as { opted_out?: boolean } | null)?.opted_out)
}
