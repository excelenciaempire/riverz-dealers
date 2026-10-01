/* eslint-disable @typescript-eslint/no-explicit-any -- doble de Supabase en memoria */
import { describe, expect, it } from 'vitest'
import { simularDisparo, varsDePedido } from './simulacion'

function dbConTablas(tablas: Record<string, any[]>, failure?: string) {
  return {
    from: (tabla: string) => {
      const filtros: Array<(r: any) => boolean> = []
      let start = 0, end = Infinity
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => { filtros.push((r) => r[k] === v); return q },
        is: (k: string, v: any) => { filtros.push((r) => (r[k] ?? null) === v); return q },
        in: (k: string, vs: any[]) => { filtros.push((r) => vs.includes(r[k])); return q },
        // Sólo la forma que usa el simulador: `col.eq.valor,col.eq.valor`.
        or: (expr: string) => {
          const partes = expr.split(',').map((p) => p.split('.eq.'))
          filtros.push((r) => partes.some(([k, v]) => String(r[k]) === v))
          return q
        },
        order: () => q,
        limit: () => q,
        range: (from: number, to: number) => { start = from; end = to; return q },
        then: (res: any, rej: any) =>
          Promise.resolve({ data: (tablas[tabla] ?? []).filter((r) => filtros.every((f) => f(r))).slice(start, end + 1), error: tabla === failure ? { message: 'private_database_details' } : null }).then(res, rej),
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

  it('una tienda argentina prueba con dirección, envío y transportista de allá', () => {
    const v = varsDePedido('shopify_order_fulfilled', { ...pedidoCod, currency: 'ARS', guia: '3600031' })
    expect(v.shipping_city).toBe('CABA')
    expect(v.shipping_method).toBe('Envío a domicilio Andreani')
    expect(v.tracking_company).toBe('Andreani')
    expect(v.tracking_url).toBe('https://www.andreani.com/envio/3600031')
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

  it('«tiene valor» decide sin comparar contra nada', async () => {
    const db2 = dbConTablas({
      automations: [{ id: 'a', workspace_id: 'w', name: 'Envío', trigger_type: 'shopify_order_fulfilled', is_active: true, deleted_at: null, trigger_config: {} }],
      automation_steps: [
        { id: 'c', automation_id: 'a', parent_step_id: null, branch: null, position: 0, step_type: 'condition', step_config: { subject: 'context_var', operand: 'tracking_number', op: 'not_empty', value: '' } },
        { id: 's', automation_id: 'a', parent_step_id: 'c', branch: 'yes', position: 0, step_type: 'send_template', step_config: { template_name: 'envio', language: 'es', variables: { '1': '{{vars.tracking_number}}' } } },
      ],
      message_templates: [{ workspace_id: 'w', name: 'envio', language: 'es', body_text: 'Guía {{1}}', buttons: null }],
      ai_agents: [],
    })
    const sin = await simularDisparo(db2, 'w', 'shopify_order_fulfilled', pedidoCod)
    expect(sin.automatizaciones[0].pasos.map((p) => p.tipo)).toEqual(['condicion'])
    const con = await simularDisparo(db2, 'w', 'shopify_order_fulfilled', { ...pedidoCod, guia: 'RA9' })
    expect(con.automatizaciones[0].pasos.map((p) => p.tipo)).toEqual(['condicion', 'plantilla'])
  })

  it('muestra la armada que espera a Meta, con lo que le falta, y deja afuera el borrador', async () => {
    const db3 = dbConTablas({
      automations: [
        { id: 'armada', workspace_id: 'w', name: 'Nuevo pedido', trigger_type: 'shopify_order_created', is_active: false,
          activation_state: 'armed', deleted_at: null, trigger_config: {},
          activation_blockers: [{ key: 'automations.issuePlantillaNoAprobada', message: 'all templates must be approved' }] },
        { id: 'borrador', workspace_id: 'w', name: 'Borrador', trigger_type: 'shopify_order_created', is_active: false,
          activation_state: 'draft', deleted_at: null, trigger_config: {} },
      ],
      automation_steps: [], message_templates: [], ai_agents: [],
    })
    const { automatizaciones } = await simularDisparo(db3, 'w', 'shopify_order_created', pedidoCod)
    expect(automatizaciones.map((a) => a.id)).toEqual(['armada'])
    expect(automatizaciones[0].armada).toEqual(['automations.issuePlantillaNoAprobada'])
  })

  it('con todo apagado muestra las apagadas para probarlas', async () => {
    const db4 = dbConTablas({
      automations: [
        { id: 'borrador', workspace_id: 'w', name: 'Nuevo pedido', trigger_type: 'shopify_order_created', is_active: false,
          activation_state: 'draft', deleted_at: null, trigger_config: {} },
      ],
      automation_steps: [], message_templates: [], ai_agents: [],
    })
    const { automatizaciones } = await simularDisparo(db4, 'w', 'shopify_order_created', pedidoCod)
    expect(automatizaciones.map((a) => a.id)).toEqual(['borrador'])
    expect(automatizaciones[0]).toMatchObject({ apagada: true, armada: null })
  })

  it('un pedido pagado dispara también las de pedido confirmado, con las unidades de la oferta', async () => {
    const db5 = dbConTablas({
      automations: [
        { id: 'recompra', workspace_id: 'w', name: 'Recompras', trigger_type: 'shopify_order_confirmed', is_active: true, deleted_at: null, trigger_config: {} },
      ],
      automation_steps: [
        { id: 'p', automation_id: 'recompra', parent_step_id: null, branch: null, position: 0, step_type: 'condition',
          step_config: { subject: 'context_var', operand: 'retention_product', op: 'eq', value: 'Shampoo' } },
        { id: 'u', automation_id: 'recompra', parent_step_id: 'p', branch: 'yes', position: 0, step_type: 'condition',
          step_config: { subject: 'context_var', operand: 'retention_units', op: 'eq', value: '2' } },
        { id: 'c', automation_id: 'recompra', parent_step_id: 'u', branch: 'yes', position: 0, step_type: 'condition',
          step_config: { subject: 'purchased', operand: 'since_trigger', value: 'false' } },
        { id: 'o', automation_id: 'recompra', parent_step_id: 'c', branch: 'yes', position: 0, step_type: 'condition',
          step_config: { subject: 'order_paid', value: 'true' } },
      ],
      message_templates: [], ai_agents: [],
    })
    const pagado = { ...pedidoCod, pago: 'mercadopago' as const, producto: { title: 'Shampoo', price: '61990', quantity: 2 } }
    const { automatizaciones } = await simularDisparo(db5, 'w', 'shopify_order_created', pagado)
    expect(automatizaciones.map((a) => a.id)).toEqual(['recompra'])
    expect(automatizaciones[0].pasos.map((p) => (p.tipo === 'condicion' ? p.camino : p.tipo))).toEqual(['yes', 'yes', 'yes', 'yes'])
    const pendiente = await simularDisparo(db5, 'w', 'shopify_order_created', { ...pagado, pago: 'pendiente' })
    expect(pendiente.automatizaciones).toEqual([])
  })

  it('una activa no lleva nada pendiente', async () => {
    const { automatizaciones } = await simularDisparo(db, 'w', 'shopify_order_fulfilled', pedidoCod)
    expect(automatizaciones[0].armada).toBeNull()
  })
  it.each(['shopify_connections', 'channel_connections', 'automations', 'automation_steps', 'message_templates', 'ai_agents'])('does not return a reassuring partial preview when %s fails', async failure => {
    const tables = {
      automations: [{ id: 'flow', workspace_id: 'w', name: 'Flow', trigger_type: 'shopify_order_fulfilled', is_active: true, deleted_at: null, trigger_config: {} }],
      automation_steps: [{ id: 'step', automation_id: 'flow', parent_step_id: null, position: 0, step_type: 'send_template', step_config: { template_name: 'shipping', language: 'es' } }],
      message_templates: [], ai_agents: [],
    }
    await expect(simularDisparo(dbConTablas(tables, failure), 'w', 'shopify_order_fulfilled', pedidoCod)).rejects.toThrow('automation_simulation_unavailable')
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
