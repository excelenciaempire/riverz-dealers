/* eslint-disable @typescript-eslint/no-explicit-any -- doble de Supabase en memoria */
import { describe, expect, it } from 'vitest'
import { simularDisparo, varsDePedido } from './simulacion'

function dbConTablas(tablas: Record<string, any[]>) {
  return {
    from: (tabla: string) => {
      const filtros: Array<(r: any) => boolean> = []
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => { filtros.push((r) => r[k] === v); return q },
        is: (k: string, v: any) => { filtros.push((r) => (r[k] ?? null) === v); return q },
        in: (k: string, vs: any[]) => { filtros.push((r) => vs.includes(r[k])); return q },
        order: () => q,
        then: (res: any, rej: any) =>
          Promise.resolve({ data: (tablas[tabla] ?? []).filter((r) => filtros.every((f) => f(r))), error: null }).then(res, rej),
      }
      return q
    },
  } as any
}

const pedidoCod = {
  producto: { title: 'Tenis Runner 42', price: '189900' },
  currency: 'COP',
  pago: 'cod' as const,
  cliente: { nombre: 'Ana Prueba', telefono: '+573000000000' },
}

describe('varsDePedido', () => {
  it('arma las variables que usan las plantillas de confirmación', () => {
    const v = varsDePedido('shopify_order_created', pedidoCod)
    expect(v.order_items).toBe('1 × Tenis Runner 42')
    expect(v.contact_first_name).toBe('Ana')
    expect(v.total_price_display).toBe('189.900 COP')
    expect(v.financial_status).toBe('pending')
    expect(v.delivery_phone).toBe('+573000000000')
  })

  it('despachado sin guía deja tracking_number vacío; con guía lo rellena', () => {
    expect(varsDePedido('shopify_order_fulfilled', pedidoCod).tracking_number).toBe('')
    expect(varsDePedido('shopify_order_fulfilled', { ...pedidoCod, guia: 'RA1' }).tracking_number).toBe('RA1')
  })
})

describe('simularDisparo', () => {
  const db = dbConTablas({
    automations: [
      { id: 'a1', workspace_id: 'w', name: 'Envío', trigger_type: 'shopify_order_fulfilled', is_active: true, deleted_at: null,
        trigger_config: { handoff_ai_agent_id: 'ag2', stop_on_inbound: true } },
      { id: 'apagada', workspace_id: 'w', name: 'Vieja', trigger_type: 'shopify_order_fulfilled', is_active: false, deleted_at: null, trigger_config: {} },
    ],
    automation_steps: [
      { id: 's1', automation_id: 'a1', parent_step_id: null, branch: null, position: 0, step_type: 'condition',
        step_config: { subject: 'context_var', operand: 'tracking_number', op: 'eq', value: '' } },
      { id: 's2', automation_id: 'a1', parent_step_id: 's1', branch: 'no', position: 0, step_type: 'send_template',
        step_config: { template_name: 'envio', language: 'es', variables: { '1': '{{vars.order_items}}', '2': '{{vars.tracking_number}}' } } },
      { id: 's3', automation_id: 'a1', parent_step_id: 's1', branch: 'no', position: 1, step_type: 'wait', step_config: { amount: 3, unit: 'hours' } },
    ],
    message_templates: [
      { workspace_id: 'w', name: 'envio', language: 'es', body_text: 'Ya salió {{1}}. Guía: {{2}}', buttons: [{ text: 'Rastrear', type: 'URL' }] },
    ],
    ai_agents: [{ id: 'ag2', workspace_id: 'w', name: 'Postventa', deleted_at: null }],
  })

  it('sin guía toma el camino «sí» de la condición y no manda nada', async () => {
    const { automatizaciones } = await simularDisparo(db, 'w', 'shopify_order_fulfilled', pedidoCod)
    expect(automatizaciones).toHaveLength(1)
    expect(automatizaciones[0].agente).toEqual({ id: 'ag2', nombre: 'Postventa' })
    expect(automatizaciones[0].pasos.map((p) => p.tipo)).toEqual(['condicion'])
    expect(automatizaciones[0].pasos[0]).toMatchObject({ camino: 'yes', asumido: false })
  })

  it('con guía rellena la plantilla, lista los botones y la espera', async () => {
    const { automatizaciones } = await simularDisparo(db, 'w', 'shopify_order_fulfilled', { ...pedidoCod, guia: 'RA123' })
    const pasos = automatizaciones[0].pasos
    expect(pasos.map((p) => p.tipo)).toEqual(['condicion', 'plantilla', 'espera'])
    expect(pasos[1]).toMatchObject({
      tipo: 'plantilla', nombre: 'envio', texto: 'Ya salió 1 × Tenis Runner 42. Guía: RA123',
      botones: [{ text: 'Rastrear', type: 'URL' }], vacias: [],
    })
  })

  it('en DeUNA un pedido pagado con Mercado Pago no recibe la confirmación de contra entrega', async () => {
    const deuna = dbConTablas({
      automations: [
        { id: 'f29f3d74-f10f-42a5-946a-15b254a70106', workspace_id: '36f81b96-41b9-4d29-b72e-11be3d3070a3', name: 'Confirmación', trigger_type: 'shopify_order_created', is_active: true, deleted_at: null, trigger_config: {} },
      ],
      automation_steps: [], message_templates: [], ai_agents: [],
    })
    const pagado = await simularDisparo(deuna, '36f81b96-41b9-4d29-b72e-11be3d3070a3', 'shopify_order_created', { ...pedidoCod, pago: 'mercadopago' })
    expect(pagado.automatizaciones[0].omitida).toBe('order_already_confirmed_or_paid')
    const cod = await simularDisparo(deuna, '36f81b96-41b9-4d29-b72e-11be3d3070a3', 'shopify_order_created', pedidoCod)
    expect(cod.automatizaciones[0].omitida).toBeNull()
  })
})
