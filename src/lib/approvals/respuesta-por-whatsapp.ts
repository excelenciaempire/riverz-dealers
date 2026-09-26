import { supabaseAdmin } from '@/lib/channels/admin-client'
import { platformWhatsApp } from '@/lib/admin/platform-whatsapp'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { parseReply, resolveByCode } from '@/lib/approvals/resolve'

/** ¿Es el número de Riverz y no el de un comercio? */
export async function esNumeroDeLaPlataforma(phoneNumberId: string): Promise<boolean> {
  if (process.env.PLATFORM_WHATSAPP_PHONE_ID === phoneNumberId) return true
  const { data } = await supabaseAdmin()
    .from('platform_whatsapp_settings')
    .select('phone_number_id')
    .maybeSingle()
  return (data as { phone_number_id?: string } | null)?.phone_number_id === phoneNumberId
}

interface MensajeEntrante {
  from: string
  text?: { body?: string }
  button?: { text?: string }
}

/**
 * "SI a1b2c3" / "NO a1b2c3" — la decisión del comerciante.
 *
 * Se contesta siempre, salga bien o mal: alguien que aprueba algo por
 * WhatsApp y no recibe nada de vuelta no sabe si funcionó, y termina
 * entrando al panel a verificar — que es justo lo que este canal ahorra.
 */
export async function atenderRespuestaDeAprobacion(value: {
  messages?: MensajeEntrante[]
}): Promise<void> {
  const db = supabaseAdmin()
  const plataforma = await platformWhatsApp()
  for (const msg of value.messages ?? []) {
    const texto = msg.text?.body ?? msg.button?.text ?? ''
    const parsed = parseReply(texto)
    if (!parsed) continue
    const res = await resolveByCode(db, {
      code: parsed.code,
      decision: parsed.decision,
      phone: msg.from,
    })
    if (!plataforma) continue
    try {
      await sendTextMessage({
        phoneNumberId: plataforma.phoneNumberId,
        accessToken: plataforma.token,
        to: msg.from,
        text: res.message,
      })
    } catch {
      /* el aviso de vuelta es cortesía: la decisión ya quedó tomada */
    }
  }
}

/**
 * Las respuestas al número de Riverz que llegan por el webhook unificado de
 * canales (el que está configurado en Meta). Ese webhook solo enruta a
 * conexiones de comercios, así que sin esto un "SI a1b2c3" se descartaba.
 */
export async function atenderNumeroDeLaPlataforma(payload: unknown): Promise<void> {
  const entries = (payload as { entry?: unknown })?.entry
  if (!Array.isArray(entries)) return
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes
    if (!Array.isArray(changes)) continue
    for (const ch of changes as Array<{ field?: string; value?: Record<string, unknown> }>) {
      if (ch?.field !== 'messages') continue
      const pid = (ch.value?.metadata as { phone_number_id?: unknown } | undefined)?.phone_number_id
      if (typeof pid !== 'string' || !Array.isArray(ch.value?.messages)) continue
      if (!(await esNumeroDeLaPlataforma(pid))) continue
      await atenderRespuestaDeAprobacion(ch.value as { messages?: MensajeEntrante[] })
    }
  }
}
