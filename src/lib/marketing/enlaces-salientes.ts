/**
 * Preparación final de enlaces salientes.
 *
 * Los enlaces largos se marcan (`riverz=<canal>`) y se muestran mediante un
 * enlace corto de Riverz. Los enlaces que ya son breves se conservan tal cual:
 * cambiarlos de dominio empeora la confianza y no ahorra espacio visible.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createShortLink } from '@/lib/links/short-link'
import { shortLinkPublicUrl } from '@/lib/whatsapp/dynamic-links'
import { marcarParaCanal, medioParaCanal, PARAM } from './enlaces'
import { prepareEmailWhatsAppLinks } from '@/lib/channels/email/whatsapp-referral'

const RE_URL = /https?:\/\/[^\s<>"']+/g
const COLA = /[.,;:!?)\]}»"']+$/

const LARGO_MINIMO_PARA_ACORTAR = 80

export interface PrepararTextoParaCanalArgs {
  texto: string
  canal: string
  workspaceId: string
  contactId?: string | null
  connectionId?: string
  conversationId?: string
}

function tieneMarcaRiverz(url: string): boolean {
  try {
    return new URL(url).searchParams.has(PARAM)
  } catch {
    return false
  }
}

/**
 * Marca y acorta sólo los enlaces externos realmente largos.
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
  if (!args.texto.includes('http')) return args.texto

  args = { ...args, texto: await prepareEmailWhatsAppLinks(db, {
    text: args.texto, channel: args.canal, workspaceId: args.workspaceId,
    connectionId: args.connectionId, conversationId: args.conversationId,
  }) }

  const reemplazos = new Map<string, string>()
  let salida = ''
  let cursor = 0

  for (const match of args.texto.matchAll(RE_URL)) {
    const bruto = match[0]
    const inicio = match.index
    const cola = bruto.match(COLA)?.[0] ?? ''
    const url = cola ? bruto.slice(0, -cola.length) : bruto
    let visible = url

    // Keep the email redirect visible to the repeated-redirect guard, also on
    // staging hosts whose domain is not in the public Riverz domain list.
    const emailWhatsAppLink = /\/api\/email\/whatsapp\/[a-f0-9]{24}(?:[?#]|$)/.test(url)
    if (url.length >= LARGO_MINIMO_PARA_ACORTAR && !emailWhatsAppLink) {
      const destino = marcarParaCanal(url, args.canal)
      const existente = reemplazos.get(destino)
      if (existente) {
        visible = existente
      } else if (tieneMarcaRiverz(destino)) {
        try {
          const token = await createShortLink(db, {
            workspaceId: args.workspaceId,
            contactId: args.contactId ?? null,
            // La marca queda DENTRO del destino. `/r/:token` no necesita
            // adivinar el comercio ni el canal cuando llegue el clic.
            targetUrl: destino,
          })
          visible = shortLinkPublicUrl(token)
          reemplazos.set(destino, visible)
        } catch (error) {
          console.error('[short-links] no se pudo acortar el enlace:', error)
          visible = destino
          reemplazos.set(destino, destino)
        }
      }
    }

    salida += args.texto.slice(cursor, inicio) + visible + cola
    cursor = inicio + bruto.length
  }

  return salida + args.texto.slice(cursor)
}
