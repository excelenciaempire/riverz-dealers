import type { MessageButton } from '@/types'

/**
 * Convierte los botones definidos en una plantilla (`message_templates.buttons`)
 * al shape que guarda `messages.buttons` para renderizarlos en la bandeja.
 *
 * Para el botón URL DINÁMICO (con `{{1}}` en la url) reemplaza el placeholder
 * por el short link real de ESTE envío (`buttonUrlParam` en el índice
 * `buttonUrlIndex`), así el enlace es clickeable en el inbox. Los botones con
 * url estática se guardan tal cual. Devuelve `null` cuando la plantilla no
 * tiene botones.
 */
export function resolveTemplateButtons(
  tplButtons: Array<Record<string, unknown>> | null | undefined,
  dyn: { buttonUrlParam?: string; buttonUrlIndex?: number } = {},
): MessageButton[] | null {
  if (!Array.isArray(tplButtons) || tplButtons.length === 0) return null
  const out: MessageButton[] = tplButtons.map((b, i) => {
    const type = String(b?.type ?? '')
    const text = String(b?.text ?? '')
    if (type === 'URL') {
      let url = String(b?.url ?? '')
      // Botón dinámico: {{1}} → el token del short link creado para este envío.
      if (i === dyn.buttonUrlIndex && dyn.buttonUrlParam) {
        url = url.replace(/\{\{\s*1\s*\}\}/, dyn.buttonUrlParam)
      }
      return { type, text, url }
    }
    if (type === 'PHONE_NUMBER') {
      return { type, text, phone_number: String(b?.phone_number ?? '') }
    }
    return { type: type || 'QUICK_REPLY', text }
  })
  return out
}
