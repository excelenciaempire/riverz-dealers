import { describe, expect, it } from 'vitest'
import { issueDetailText } from '@/lib/health/detail'
import { translate } from '@/lib/i18n/translate'

const t = (k: string, v?: Record<string, string | number>) => translate('es', k, v)

describe('issueDetailText: los avisos de Meta en castellano', () => {
  // La frase que aparecía cruda en el panel de producción.
  it('traduce el aviso de "healthy ecosystem" aunque venga sin código', () => {
    // El aviso va con `sends_failing` y no con `voice_send_failed`: al segundo
    // se le muestra al comercio qué hacer en vez del motivo de Meta, así que
    // no pasa por esta traducción. Lo que se protege acá es la traducción, no
    // el aviso.
    const out = issueDetailText(
      'sends_failing',
      'In order to maintain a healthy ecosystem engagement, the message failed to be delivered.',
      t,
    )
    expect(out).toBe(translate('es', 'deliveryErrors.code131049', { code: 131049 }))
  })

  it('sigue prefiriendo el código cuando Meta lo escribe', () => {
    const out = issueDetailText('automation_failed', '(#131008) Required parameter is missing', t)
    expect(out).toBe(translate('es', 'deliveryErrors.code131008', { code: 131008 }))
  })

  it('no deja en inglés ninguna de las frases conocidas de Meta', () => {
    const frases = [
      'Message failed to send because more than 24 hours have passed since the customer last replied to this number.',
      'This recipient has chosen to stop receiving marketing messages.',
      'Message Undeliverable.',
      'Spam rate limit hit.',
      'Required parameter is missing',
      'Number of parameters does not match the expected number of params',
      'Business Account is restricted from messaging users.',
      'Service temporarily unavailable.',
    ]
    for (const f of frases) {
      const out = issueDetailText('automation_failed', f, t)
      expect(out, f).not.toBe(f)
      expect(out, f).toBeTruthy()
    }
  })

  /**
   * El mismo aviso, contado a dos personas con poderes distintos.
   *
   * Al comercio le llegaba «WhatsApp limitó los mensajes de marketing que
   * recibe esta persona. Reintenta en 24 h.»: un consejo que no puede seguir
   * —no hay botón de reintentar— y que encima le cobraba a él una causa que
   * era nuestra (elegíamos una plantilla que Meta había recategorizado).
   */
  it('al comercio le dice qué hacer, no el código de Meta', () => {
    const crudo =
      'In order to maintain a healthy ecosystem engagement, the message failed to be delivered.'
    const paraElComercio = issueDetailText('voice_send_failed', crudo, t)
    expect(paraElComercio).toBe(translate('es', 'health.detailVoiceSendFailed'))
    expect(paraElComercio).not.toMatch(/marketing|24 h/i)
  })

  it('a la plataforma le deja el motivo tecnico, que es quien puede arreglarlo', () => {
    const crudo =
      'In order to maintain a healthy ecosystem engagement, the message failed to be delivered.'
    expect(issueDetailText('voice_send_failed', crudo, t, true)).toBe(
      translate('es', 'deliveryErrors.code131049', { code: 131049 }),
    )
  })

  it('no toca los nombres propios ni inventa traducción para lo que no conoce', () => {
    expect(issueDetailText('template_rejected', 'carrito_abandonado_v2', t)).toBe(
      'carrito_abandonado_v2',
    )
    expect(issueDetailText('automation_failed', 'algo que nadie mapeó', t)).toBe(
      'algo que nadie mapeó',
    )
  })
})
