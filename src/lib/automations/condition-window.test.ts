import { describe, it, expect } from 'vitest'
import { AUTOMATION_TEMPLATES } from './templates'

/**
 * Las recetas y las opciones de ventana, comprobadas contra el catálogo.
 *
 * Son datos, no comportamiento: un flujo mal seteado acá no rompe ningún
 * test de motor, se instala como está y recién se nota cuando alguien mira
 * el lienzo — o peor, cuando el mensaje sale a destiempo.
 */

describe('receta de pago rechazado', () => {
  const tpl = AUTOMATION_TEMPLATES['pago-rechazado']

  it('espera 10 minutos y pregunta si compró antes de escribir', () => {
    expect(tpl.trigger_type).toBe('payment_rejected')
    const [wait, cond, send, tag] = tpl.steps
    expect(wait.step_type).toBe('wait')
    expect(wait.step_config).toMatchObject({ amount: 10, unit: 'minutes' })
    expect(cond.step_type).toBe('condition')
    expect(cond.step_config).toMatchObject({
      subject: 'purchased',
      // Desde que arrancó el flujo, no una duración repetida: si repitiera
      // los 10 minutos habría que mantener dos números sincronizados.
      operand: 'since_trigger',
      value: 'false',
    })
    // El envío cuelga de la rama que se cumple, no del tronco.
    expect(send.branch).toBe('yes')
    expect(tag.branch).toBe('yes')
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

  it('espera 15 minutos y pregunta si compró antes de escribir', () => {
    const [wait, cond, send, tag] = tpl.steps
    expect(wait.step_type).toBe('wait')
    expect(wait.step_config).toMatchObject({ amount: 15, unit: 'minutes' })
    expect(cond.step_config).toMatchObject({
      subject: 'purchased',
      operand: 'since_trigger',
      value: 'false',
    })
    expect(send.branch).toBe('yes')
    expect(tag.branch).toBe('yes')
  })

  it('NO repite la barrera de "ya le escribimos"', () => {
    // El motor la aplica siempre, se arme el flujo como se arme. Tenerla
    // también como paso hacía creer que borrarla la desactiva.
    const subjects = tpl.steps
      .filter((s) => s.step_type === 'condition')
      .map((s) => (s.step_config as { subject?: string }).subject)
    expect(subjects).not.toContain('messaged')
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
