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
      // El cruce con el rescate de carrito, a la vista. Cuenta CUALQUIER
      // plantilla, no sólo las de rescate: dos días alcanzan para no
      // insistir por el mismo episodio sin apagar la recuperación.
      { subject: 'messaged', operand: '48h', value: 'false' },
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
  const nombreEtiqueta = (s: (typeof tpl.steps)[number]) =>
    (s.step_config as { tag_name?: string }).tag_name
  const porEtiqueta = (nombre: string) => {
    const i = tpl.steps.findIndex((s) => nombreEtiqueta(s) === nombre)
    return { i, paso: tpl.steps[i] }
  }

  it('marca el carrito abandonado antes de esperar', () => {
    // Abandonar es un hecho, no un resultado: ya pasó cuando esto corre. Si
    // la etiqueta fuera después de las barreras, el que ya había recibido un
    // mensaje esta semana quedaría sin marcar y desaparecería del segmento.
    const [primero, segundo] = tpl.steps
    expect(primero.step_type).toBe('add_tag')
    expect(nombreEtiqueta(primero)).toBe('carrito-abandonado')
    expect(primero.parent_index ?? null).toBeNull()
    expect(segundo.step_type).toBe('wait')
    expect(segundo.step_config).toMatchObject({ amount: 15, unit: 'minutes' })
  })

  it('encadena las tres preguntas que lo separan del otro rescate', () => {
    expect(cfgs('carrito-abandonado').slice(0, 3)).toEqual([
      { subject: 'purchased', operand: 'since_trigger', value: 'false' },
      // Gana pago rechazado: dice lo que pasó de verdad y su plantilla es
      // Utility, que Meta entrega.
      { subject: 'rejected_open', operand: '48h', value: 'false' },
      { subject: 'messaged', operand: '48h', value: 'false' },
    ])
  })

  it('el envío cuelga de la última condición, no de la primera', () => {
    const send = tpl.steps.find((s) => s.step_type === 'send_template')
    expect(send?.branch).toBe('yes')
    expect(send?.parent_index).toBe(4)
  })

  it('la etiqueta de recuperado sólo cuelga de haber comprado', () => {
    // ESTE es el invariante caro: puesta al lado del envío marcaría a todo el
    // que recibió el mensaje y la etiqueta no diría nada. Tiene que colgar de
    // la pregunta "compró", en su rama del sí.
    const { i, paso } = porEtiqueta('carrito-recuperado')
    expect(paso.step_type).toBe('add_tag')
    expect(paso.branch).toBe('yes')

    const madre = tpl.steps[paso.parent_index as number]
    expect(madre.step_type).toBe('condition')
    expect(madre.step_config).toMatchObject({ subject: 'purchased', value: 'true' })
    // Y esa pregunta vive en el mismo carril que el envío: preguntar antes de
    // haber escrito atribuiría al flujo una compra que no provocó.
    expect(madre.parent_index).toBe(4)
    expect(i).toBeGreaterThan(tpl.steps.findIndex((s) => s.step_type === 'send_template'))
  })

  it('espera dos días entre el mensaje y la atribución', () => {
    // Sin la espera, la pregunta se contesta en el mismo segundo del envío:
    // nadie compró todavía y la etiqueta no se pondría nunca.
    const esperas = tpl.steps.filter((s) => s.step_type === 'wait')
    expect(esperas.map((s) => s.step_config)).toEqual([
      { amount: 15, unit: 'minutes' },
      { amount: 48, unit: 'hours' },
    ])
    const atribucion = esperas[1]
    const send = tpl.steps.find((s) => s.step_type === 'send_template')
    expect(atribucion.parent_index).toBe(send?.parent_index)
    expect(atribucion.branch).toBe('yes')
  })
})

describe('receta de pago pendiente (transferencia)', () => {
  const tpl = AUTOMATION_TEMPLATES['pago-pendiente']

  it('sale del flujo si el pedido ya está pagado', () => {
    expect(tpl.trigger_type).toBe('shopify_order_created')
    expect(tpl.steps[0].step_config).toMatchObject({
      subject: 'context_var',
      operand: 'financial_status',
      value: 'pending',
    })
  })

  it('recuerda a la 1 h, a las 6 y a las 24 del pedido', () => {
    // Las esperas son acumulativas: 1 + 5 + 18 = 24 h desde el pedido.
    const waits = tpl.steps
      .filter((s) => s.step_type === 'wait')
      .map((s) => s.step_config as { amount: number; unit: string })
    expect(waits).toEqual([
      { amount: 1, unit: 'hours' },
      { amount: 5, unit: 'hours' },
      { amount: 18, unit: 'hours' },
    ])
  })

  it('vuelve a preguntar si pagó antes de cada recordatorio', () => {
    const paid = cfgs('pago-pendiente').filter((c) => c.subject === 'order_paid')
    expect(paid).toEqual([
      { subject: 'order_paid', value: 'false' },
      { subject: 'order_paid', value: 'false' },
      { subject: 'order_paid', value: 'false' },
    ])
    expect(tpl.steps.filter((s) => s.step_type === 'send_template')).toHaveLength(3)
  })

  it('NO lleva la barrera de "ya le escribimos"', () => {
    // La confirmación del pedido sale minutos antes, así que esa barrera
    // mataría este flujo el primer día. Su anti-duplicado es preguntar si
    // pagó, no cuánto hace que le hablamos.
    expect(cfgs('pago-pendiente').map((c) => c.subject)).not.toContain('messaged')
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
