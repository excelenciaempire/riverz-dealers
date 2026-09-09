/**
 * Preparación final de enlaces salientes.
 *
 * La tienda recibe la URL real ya marcada (`riverz=<canal>`), pero la persona
 * ve un enlace corto de Riverz. Cada token pertenece a un workspace y, cuando
 * existe, a un contacto: nunca se comparte configuración ni destino entre
 * comercios.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createShortLink } from '@/lib/links/short-link'
import { shortLinkPublicUrl } from '@/lib/whatsapp/dynamic-links'
import { marcarParaCanal, medioParaCanal, PARAM } from './enlaces'

const RE_URL = /https?:\/\/[^\s<>"']+/g
const COLA = /[.,;:!?)\]}»"']+$/

export interface PrepararTextoParaCanalArgs {
  texto: string
  canal: string
  workspaceId: string
  contactId?: string | null
}

function tieneMarcaRiverz(url: string): boolean {
  try {
    return new URL(url).searchParams.has(PARAM)
  } catch {
    return false
  }
}

/**
 * Marca y acorta todos los enlaces externos de un mensaje.
 *
 * Fail-open a propósito: si el servicio de enlaces cortos no puede insertar
 * una fila, se conserva la URL larga ya marcada. El mensaje sigue saliendo y
 * la venta continúa siendo atribuible; sólo se pierde la presentación corta.
 */
export async function prepararTextoParaCanal(
  db: SupabaseClient,
  args: PrepararTextoParaCanalArgs,
): Promise<string> {
  if (!medioParaCanal(args.canal)) return args.texto
  const marcado = marcarParaCanal(args.texto, args.canal)
  if (!marcado.includes('http')) return marcado

  const reemplazos = new Map<string, string>()
  let salida = ''
  let cursor = 0

  for (const match of marcado.matchAll(RE_URL)) {
    const bruto = match[0]
    const inicio = match.index
    const cola = bruto.match(COLA)?.[0] ?? ''
    const url = cola ? bruto.slice(0, -cola.length) : bruto
    let visible = url

    if (tieneMarcaRiverz(url)) {
      const existente = reemplazos.get(url)
      if (existente) {
        visible = existente
      } else {
        try {
          const token = await createShortLink(db, {
            workspaceId: args.workspaceId,
            contactId: args.contactId ?? null,
            // La marca queda DENTRO del destino. `/r/:token` no necesita
            // adivinar el comercio ni el canal cuando llegue el clic.
            targetUrl: url,
          })
          visible = shortLinkPublicUrl(token)
          reemplazos.set(url, visible)
        } catch (error) {
          console.error('[short-links] no se pudo acortar el enlace:', error)
          reemplazos.set(url, url)
        }
      }
    }

    salida += marcado.slice(cursor, inicio) + visible + cola
    cursor = inicio + bruto.length
  }

  return salida + marcado.slice(cursor)
}
