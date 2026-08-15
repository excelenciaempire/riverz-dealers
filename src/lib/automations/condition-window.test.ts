import { describe, it, expect } from 'vitest'
import { AUTOMATION_TEMPLATES } from './templates'

/**
 * Las recetas y las opciones de ventana, comprobadas contra el catálogo.
 *
 * Son datos, no comportamiento: un flujo mal seteado acá no rompe ningún
 * test de motor, se instala como está y recién se nota cuando alguien mira
 * el lienzo — o peor, cuando el mensaje sale a destiempo.
 */

type Cfg = { subject?: string; operand?: string; value?: string }
const cfgs = (slug: keyof typeof AUTOMATION_TEMPLATES) =>
  AUTOMATION_TEMPLATES[slug].steps
    .filter((s) => s.step_type === 'condition')
    .map((s) => s.step_config as Cfg)

describe('receta de pago rechazado', () => {
  const tpl = AUTOMATION_TEMPLATES['pago-rechazado']

  it('espera 10 minutos antes de preguntar nada', () => {
    expect(tpl.trigger_type).toBe('payment_rejected')
    const [wait] = tpl.steps
    expect(wait.step_type).toBe('wait')
    expect(wait.step_config).toMatchObject({ amount: 10, unit: 'minutes' })
  })

  it('pregunta si compró y si ya le escribimos, en ese orden', () => {
    expect(cfgs('pago-rechazado')).toEqual([
      // Desde que arrancó el flujo, no una duración repetida: si repitiera
      // los 10 minutos habría que mantener dos números sincronizados.
      { subject: 'purchased', operand: 'since_trigger', value: 'false' },
      // El cruce con el rescate de carrito, a la vista. La ventana va al
      // techo del motor (90 dias) porque aca conviene equivocarse por no
      // molestar: quien recibio CUALQUIER plantilla en ese plazo queda afuera.
      { subject: 'messaged', operand: '90d', value: 'false' },
    ])
  })

  it('el envío y la etiqueta cuelgan de la última condición', () => {
    const send = tpl.steps.find((s) => s.step_type === 'send_template')
    const tag = tpl.steps.find((s) => s.step_type === 'add_tag')
    expect(send?.branch).toBe('yes')
    expect(tag?.branch).toBe('yes')
    // El índice 2 es la condición de "ya le escribimos": colgar de la
    // primera saltearía la segunda pregunta sin que se note en el lienzo.
    expect(send?.parent_index).toBe(2)
    expect(tag?.parent_index).toBe(2)
  })

  it('no configura nada en el disparador: vale desde que se instala', () => {
    expect(tpl.trigger_config).toEqual({})
  })

  it('sólo se ofrece con la pasarela conectada', () => {
    expect(tpl.requiresGateway).toBe('mercadopago')
  })
})

describe('receta de carrito abandonado', () => {
  const tpl = AUTOMATION_TEMPLATES['carrito-abandonado']

  it('espera 15 minutos antes de preguntar nada', () => {
    const [wait] = tpl.steps
    expect(wait.step_type).toBe('wait')
    expect(wait.step_config).toMatchObject({ amount: 15, unit: 'minutes' })
  })

  it('encadena las tres preguntas que lo separan del otro rescate', () => {
    expect(cfgs('carrito-abandonado')).toEqual([
      { subject: 'purchased', operand: 'since_trigger', value: 'false' },
      // Gana pago rechazado: dice lo que pasó de verdad y su plantilla es
      // Utility, que Meta entrega.
      { subject: 'rejected_open', operand: '90d', value: 'false' },
      { subject: 'messaged', operand: '90d', value: 'false' },
    ])
  })

  it('el envío cuelga de la última condición, no de la primera', () => {
    const send = tpl.steps.find((s) => s.step_type === 'send_template')
    const tag = tpl.steps.find((s) => s.step_type === 'add_tag')
    expect(send?.branch).toBe('yes')
    expect(send?.parent_index).toBe(3)
    expect(tag?.parent_index).toBe(3)
  })
})

describe('la espera del flujo no se duplica con la del disparador', () => {
  it('ninguna receta con paso de espera configura además hours_after', () => {
    for (const tpl of Object.values(AUTOMATION_TEMPLATES)) {
      const hasWait = tpl.steps.some((s) => s.step_type === 'wait')
      const cfg = tpl.trigger_config as Record<string, unknown>
      if (hasWait) {
        expect(cfg.hours_after, `${tpl.slug} suma dos esperas`).toBeUndefined()
      }
    }
  })
})
