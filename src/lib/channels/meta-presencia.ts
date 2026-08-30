import type { ChannelConnection } from '@/types'
import { decrypt } from './encryption'
import { withAppsecretProof } from './meta-graph'

/**
 * «Visto» y «escribiendo…» en Messenger e Instagram.
 *
 * Es la única señal que Meta deja mandar mientras se piensa la respuesta, y no
 * se usaba en ningún lado: la persona escribía y no pasaba nada hasta que
 * aparecía el mensaje entero, unos segundos después. Del otro lado eso se lee
 * como que nadie está.
 *
 * CUÁNDO SE MANDA, y por qué importa: sólo cuando de verdad vamos a contestar.
 * Marcar «visto» sobre un mensaje que la IA va a saltear —fuera de horario, la
 * conversación asignada a una persona que todavía no la abrió— sería decirle al
 * cliente que alguien lo leyó cuando no lo leyó nadie. Eso es peor que el
 * silencio: el silencio no promete nada.
 *
 * Best-effort de punta a punta. Nunca lanza y nunca se espera: si Meta rechaza
 * la marca, lo único que pasa es que no aparece el puntito. La respuesta, que
 * es lo que importa, sale igual.
 */

const GRAPH = 'https://graph.facebook.com/v21.0'

export type Presencia = 'mark_seen' | 'typing_on' | 'typing_off'

export function soportaPresencia(channel: string): boolean {
  return channel === 'messenger' || channel === 'instagram'
}

export async function marcarPresencia(
  connection: ChannelConnection,
  externalContactId: string | null | undefined,
  accion: Presencia,
): Promise<void> {
  if (!externalContactId) return
  try {
    const cfg = (connection.config ?? {}) as Record<string, unknown>
    // Messenger publica por la página; Instagram por su cuenta profesional.
    const target = String(cfg.page_id ?? cfg.ig_user_id ?? '')
    const secrets = (connection.secrets ?? {}) as Record<string, unknown>
    const enc = String(secrets.access_token ?? '')
    if (!target || !enc) return
    const token = decrypt(enc)
    if (!token) return

    await fetch(withAppsecretProof(`${GRAPH}/${target}/messages`, token), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: externalContactId },
        sender_action: accion,
      }),
      // Corto a propósito: es un adorno con fecha de vencimiento. Si tarda
      // más que la propia respuesta, ya no sirve de nada.
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    /* el puntito no puede demorar ni romper la respuesta */
  }
}
