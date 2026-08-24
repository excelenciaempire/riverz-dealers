import { describe, expect, it } from 'vitest'

import { CONDITION_SUBJECTS } from '@/types'
import { activationIssues } from './activation'
import { planDesdeIA, simularResolucion } from './ai-steps'
import { resolverReferencias } from './resolve-tag-seeds'
import type { BuilderStepInput } from './steps-tree'

/**
 * El pedido que rompió todo, de punta a punta.
 *
 * En una cuenta real alguien pidió por chat una recompra distinta según cuánto
 * había comprado. Se creó sin una sola queja y no podía funcionar: los tres
 * "¿tiene la etiqueta X?" usaban un sujeto que el motor no conoce y contestaban
 * que no para siempre, los tres "¿ya volvió a comprar?" preguntaban por el
 * pedido que acababa de pagarse —siempre que sí— y los tres mensajes eran el
 * mismo. Dieciséis pasos, cero posibilidad de mandar nada.
 *
 * Esta prueba toma el mismo pedido y afirma que lo que sale es **ejecutable por
 * el motor**, no que tenga determinada forma. Cada afirmación es una de las
 * cosas que aquella vez salió mal.
 */

const PEDIDO = {
  nombre: 'Recompra por volumen',
  disparador: 'customer_inactive',
  dias: 45,
  pasos: [
    {
      tipo: 'condition',
      dato: 'last_offer_units',
      comparador: 'eq',
      valor: '1',
      si: [
        { tipo: 'wait', cantidad: 15, unidad: 'days' },
        {
          tipo: 'condition',
          dato: 'purchased',
          ventana: 'since_trigger',
          si: [{ tipo: 'close_conversation' }],
          no: [{ tipo: 'send_template', plantilla: 'recompra_1_unidad' }],
        },
      ],
      no: [
        {
          tipo: 'condition',
          dato: 'last_offer_units',
          comparador: 'between',
          valor: '2',
          valor2: '3',
          si: [
            { tipo: 'wait', cantidad: 30, unidad: 'days' },
            {
              tipo: 'condition',
              dato: 'purchased',
              ventana: 'since_trigger',
              si: [{ tipo: 'close_conversation' }],
              no: [{ tipo: 'send_template', plantilla: 'recompra_2_3_unidades' }],
            },
          ],
          no: [
            {
              tipo: 'condition',
              dato: 'last_offer_units',
              comparador: 'gte',
              valor: '4',
              si: [
                { tipo: 'wait', cantidad: 30, unidad: 'days' },
                {
                  tipo: 'condition',
                  dato: 'purchased',
                  ventana: 'since_trigger',
                  si: [{ tipo: 'close_conversation' }],
                  no: [{ tipo: 'send_template', plantilla: 'recompra_4_mas' }],
                },
              ],
              no: [{ tipo: 'close_conversation' }],
            },
          ],
        },
      ],
    },
  ],
}

function todos(pasos: BuilderStepInput[]): BuilderStepInput[] {
  return pasos.flatMap((p) => [p, ...todos(p.branches?.yes ?? []), ...todos(p.branches?.no ?? [])])
}

const cfg = (p: BuilderStepInput) => p.step_config as Record<string, unknown>

describe('la recompra por volumen, armada desde el chat', () => {
  const { plan, problemas } = planDesdeIA(PEDIDO)

  it('se puede armar', () => {
    expect(problemas).toEqual([])
    expect(plan).not.toBeNull()
  })

  it('el disparador queda con sus días, no con la configuración vacía', () => {
    // `crear` guardaba `trigger_config: {}` fijo: por inactividad NUNCA se pudo
    // crear una que se pudiera prender.
    expect(plan!.disparadorConfig).toEqual({ days_threshold: 45 })
  })

  it('todas las preguntas usan un sujeto que el motor sabe contestar', () => {
    // La mitad exacta del bug: `subject: "tag"` cae al `default: return false`.
    const condiciones = todos(plan!.pasos).filter((p) => p.step_type === 'condition')
    expect(condiciones.length).toBe(6)
    for (const c of condiciones) {
      expect(CONDITION_SUBJECTS).toContain(cfg(c).subject as string)
    }
  })

  it('los tres tramos de volumen preguntan por el mismo dato del contacto', () => {
    const volumen = todos(plan!.pasos).filter(
      (p) => p.step_type === 'condition' && cfg(p).subject === 'contact_field',
    )
    expect(volumen.map((v) => cfg(v).operand)).toEqual([
      'last_offer_units',
      'last_offer_units',
      'last_offer_units',
    ])
    expect(volumen.map((v) => `${cfg(v).op}:${cfg(v).value}${cfg(v).value2 ? `-${cfg(v).value2}` : ''}`)).toEqual([
      'eq:1',
      'between:2-3',
      'gte:4',
    ])
  })

  it('las esperas son las que se pidieron', () => {
    const esperas = todos(plan!.pasos).filter((p) => p.step_type === 'wait')
    expect(esperas.map((e) => `${cfg(e).amount}${cfg(e).unit}`)).toEqual([
      '15days',
      '30days',
      '30days',
    ])
  })

  it('a quien ya volvió a comprar no se le escribe', () => {
    // Escrito como lo ejecuta el motor y no como lo cuenta el modelo: la
    // pregunta va en positivo y el envío cuelga de la rama del NO.
    const compras = todos(plan!.pasos).filter(
      (p) => p.step_type === 'condition' && cfg(p).subject === 'purchased',
    )
    expect(compras.length).toBe(3)
    for (const c of compras) {
      expect(cfg(c)).toMatchObject({ operand: 'since_trigger', value: 'true' })
      expect(c.branches?.yes?.[0].step_type).toBe('close_conversation')
      expect(c.branches?.no?.[0].step_type).toBe('send_template')
    }
  })

  it('cada tramo manda su propia plantilla', () => {
    // Los tres mandaban la misma, que era justo lo contrario de lo pedido.
    const envios = todos(plan!.pasos).filter((p) => p.step_type === 'send_template')
    expect(envios.map((e) => cfg(e).template_name)).toEqual([
      'recompra_1_unidad',
      'recompra_2_3_unidades',
      'recompra_4_mas',
    ])
  })

  it('ninguna pregunta queda sin nada que hacer', () => {
    for (const c of todos(plan!.pasos).filter((p) => p.step_type === 'condition')) {
      expect((c.branches?.yes?.length ?? 0) + (c.branches?.no?.length ?? 0)).toBeGreaterThan(0)
    }
  })

  it('pasa la misma puerta que el editor: se puede prender', () => {
    expect(
      activationIssues({
        triggerType: 'customer_inactive',
        triggerConfig: plan!.disparadorConfig,
        steps: simularResolucion(plan!.pasos) as never,
      }),
    ).toEqual([])
  })

  it('cuenta los dieciséis pasos, no uno', () => {
    expect(plan!.total).toBe(16)
  })
})

// ---------------------------------------------------------------------------
// La otra mitad del bug: el nombre que nunca se convirtió en id.
// ---------------------------------------------------------------------------

/** Una base de mentira que sabe listar etiquetas y plantillas. */
function baseCon(
  etiquetas: { id: string; name: string }[],
  plantillas: { name: string }[] = [],
) {
  const from = (tabla?: string) => {
    const filas = tabla === 'message_templates' ? plantillas : etiquetas
    const cadena = {
      select: () => cadena,
      eq: () => cadena,
      is: () => cadena,
      limit: async () => ({ data: filas, error: null }),
    }
    return cadena
  }
  return { from } as never
}

describe('las etiquetas de una pregunta', () => {
  const conEtiqueta = [
    {
      step_type: 'condition',
      step_config: { subject: 'tag_presence', operand: '', tag_name: 'comprador' },
      branches: { yes: [{ step_type: 'close_conversation', step_config: {} }], no: [] },
    },
  ] as BuilderStepInput[]

  it('se convierten en el id que el motor compara', () => {
    const id = '7f3a1b2c-1111-4111-8111-111111111111'
    return resolverReferencias(baseCon([{ id, name: 'comprador' }]), 'ws-1', {
      pasos: conEtiqueta,
    }).then((r) => {
      expect(r.problemas).toEqual([])
      expect((r.pasos[0].step_config as { operand: string }).operand).toBe(id)
    })
  })

  it('si no existe, lo dice con las que sí — y no la crea', () => {
    // Preguntar por una etiqueta que nadie tiene es una rama muerta: la
    // respuesta va a ser siempre que no. Crearla en silencio escondería que el
    // nombre estaba mal escrito.
    return resolverReferencias(
      baseCon([{ id: '7f3a1b2c-1111-4111-8111-111111111111', name: 'comprador recurrente' }]),
      'ws-1',
      { pasos: conEtiqueta },
    ).then((r) => {
      expect(r.problemas).toHaveLength(1)
      expect(r.problemas[0].message).toContain('comprador recurrente')
    })
  })
})

describe('la misma plantilla en varios caminos', () => {
  /** El mismo pedido, pero con una sola plantilla para las tres ramas. */
  const conUnaSola = {
    ...PEDIDO,
    pasos: JSON.parse(JSON.stringify(PEDIDO.pasos).replace(/recompra_\w+/g, 'recompra_1')),
  }

  it('se rechaza, y el mensaje dice qué hacer', () => {
    // Pasó de verdad: se pidieron tres mensajes distintos por volumen y las tres
    // ramas terminaron mandando la única plantilla aprobada que había. La
    // automatización se ve bien, se puede prender, y hace lo contrario de lo
    // que se pidió.
    const { plan, problemas } = planDesdeIA(conUnaSola)
    expect(plan).toBeNull()
    expect(problemas[0].message).toContain('recompra_1')
    expect(problemas[0].message).toContain('plantillas')
  })

  it('no hay forma de saltárselo', () => {
    // Hubo un `mismo_mensaje: true` para confirmarlo, y el modelo lo usó a la
    // primera: cuando el camino corto es declarar que está bien, se declara que
    // está bien. La salida real es sacar la pregunta, que es lo que dice el
    // mensaje.
    const { plan } = planDesdeIA({ ...conUnaSola, mismo_mensaje: true } as never)
    expect(plan).toBeNull()
  })

  it('una plantilla sola, fuera de toda rama, no molesta a nadie', () => {
    const { problemas } = planDesdeIA({
      nombre: 'Aviso',
      disparador: 'shopify_order_paid',
      pasos: [
        { tipo: 'wait', cantidad: 1, unidad: 'days' },
        { tipo: 'send_template', plantilla: 'gracias' },
      ],
    })
    expect(problemas).toEqual([])
  })
})

describe('la plantilla que se manda', () => {
  const conEnvio = [
    {
      step_type: 'send_template',
      step_config: { template_name: 'recompra_1_unidad' },
    },
  ] as BuilderStepInput[]

  it('tiene que existir de verdad', async () => {
    // Lo encontró un ensayo contra la base de verdad, no esta suite: se armó
    // una recompra apuntando a «no_existe» y se creó sin una queja. El motor la
    // busca por NOMBRE en cada disparo: si no está, no manda nada y no avisa.
    // La automatización se ve bien, se puede prender, y no le escribe a nadie —
    // que es exactamente lo que dejó muerta la recompra de una cuenta real.
    const r = await resolverReferencias(baseCon([], [{ name: 'otra_cosa' }]), 'ws-1', {
      pasos: conEnvio,
    })
    expect(r.problemas).toHaveLength(1)
    expect(r.problemas[0].message).toContain('recompra_1_unidad')
    // Y dice cuáles hay, que es lo que necesita quien la escribió mal.
    expect(r.problemas[0].message).toContain('otra_cosa')
  })

  it('si existe, no molesta', async () => {
    const r = await resolverReferencias(
      baseCon([], [{ name: 'recompra_1_unidad' }]),
      'ws-1',
      { pasos: conEnvio },
    )
    expect(r.problemas).toEqual([])
  })

  it('en borrador también vale: se arma mientras Meta revisa', async () => {
    // Que no esté aprobada NO es un problema acá. Se puede armar la
    // automatización mientras Meta revisa la plantilla; prenderla con la
    // plantilla sin aprobar es otra decisión, y la corta la activación.
    const r = await resolverReferencias(
      baseCon([], [{ name: 'recompra_1_unidad' }]),
      'ws-1',
      { pasos: conEnvio },
    )
    expect(r.problemas).toEqual([])
  })

  it('sin nombre lo dice', async () => {
    const r = await resolverReferencias(baseCon([], []), 'ws-1', {
      pasos: [{ step_type: 'send_template', step_config: {} }] as BuilderStepInput[],
    })
    expect(r.problemas[0]?.message).toMatch(/falta el nombre/i)
  })
})
