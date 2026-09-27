/* eslint-disable @typescript-eslint/no-explicit-any -- Heterogeneous in-memory Supabase rows and its fluent thenable test double. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ tables: {} as Record<string, any[]> }))
vi.mock('./admin-client', () => ({ supabaseAdmin: () => ({ from: (table: string) => {
  const filters: Array<(row: any) => boolean> = []
  let operation = 'select', payload: any, count = false, single = false
  const query: any = {
    select: (_?: string, options?: any) => { count = !!options?.count; return query },
    in: (key: string, value: any[]) => { filters.push(r => value.includes(r[key])); return query },
    eq: (key: string, value: any) => { filters.push(r => r[key] === value); return query },
    neq: (key: string, value: any) => { filters.push(r => r[key] !== value); return query },
    is: (key: string, value: any) => { filters.push(r => (r[key] ?? null) === value); return query },
    gte: (key: string, value: number) => { filters.push(r => r[key] >= value); return query },
    order: () => query,
    limit: () => query,
    single: () => { single = true; return query },
    maybeSingle: () => { single = true; return query },
    update: (value: any) => { operation = 'update'; payload = value; return query },
    insert: (value: any) => { operation = 'insert'; payload = value; return query },
    then: (resolve: any, reject: any) => Promise.resolve().then(() => {
      const rows = state.tables[table]
      if (!rows) throw Error(`Unexpected table ${table}`)
      if (operation === 'insert') {
        if (payload.id && rows.some(r=>r.id===payload.id)) return {data:null,error:{code:'23505'}}
        rows.push({ id: `new-${rows.length}`, ...payload })
      }
      const found = rows.filter(r => filters.every(f => f(r)))
      if (operation === 'update') found.forEach(r => Object.assign(r, payload))
      return { data: single ? found[0] ?? null : found, error: null, count: count ? found.length : null }
    }).then(resolve, reject),
  }
  return query
} }) }))
vi.mock('@/lib/workspaces/owner', () => ({ resolveWorkspaceOwnerUserId: async () => 'owner' }))
vi.mock('./template-ab-attribution', () => ({ assignedTemplateVariant: async () => null, recordExperimentExposure: vi.fn() }))
vi.mock('./riverzoficial-template-context', () => ({ requireRiverzoficialTemplateItems: async () => undefined }))
vi.mock('./riverzoficial-context-gate', () => ({ riverzFlowSkipReason: async () => null }))
const sendTemplate = vi.hoisted(() => vi.fn(async () => ({ whatsapp_message_id: 'wamid.1' })))
const sendText = vi.hoisted(() => vi.fn(async () => ({ whatsapp_message_id: 'wamid.text' })))
vi.mock('./meta-send', () => ({ engineSendText: sendText, engineSendTemplate: sendTemplate }))

import { resumePendingExecution } from './engine'

const envio = {
  id: 'envio', automation_id: 'a', parent_step_id: null, branch: null, position: 0, step_type: 'send_template',
  step_config: { template_name: 'rasmiaw_envio_tracking', language: 'es', variables: { '1': '{{vars.tracking_number}}' } },
}
const pendingCon = (vars: Record<string, string>) => ({
  id: 'pending', automation_id: 'a', workspace_id: 'w', contact_id: 'c', log_id: 'log',
  parent_step_id: null, branch: null, next_step_position: 0, context: { vars },
})

beforeEach(() => {
  sendTemplate.mockClear()
  sendText.mockClear()
  state.tables = {
    automations: [{ id: 'a', workspace_id: 'w', name: 'Rasmiaw · Envío', trigger_type: 'shopify_order_fulfilled', is_active: true, activation_state: 'active', trigger_config: { handoff_ai_agent_id: 'agente' } }],
    automation_pending_executions: [{ ...pendingCon({}), status: 'running', run_at: '2026-09-17T15:00:00Z' }],
    automation_logs: [{ id: 'log', status: 'partial', steps_executed: [] }],
    automation_steps: [envio],
    contacts: [{ id: 'c', name: 'Ana Pérez', email: '', phone: '573000000000', last_product: '' }],
    conversations: [{ id: 'conv', workspace_id: 'w', contact_id: 'c', channel: 'whatsapp', deleted_at: null, assigned_ai_agent_id: null }],
    message_templates: [{ workspace_id: 'w', name: 'rasmiaw_envio_tracking', language: 'es', buttons: null }],
  }
})

describe('native session-template execution',()=>{
  beforeEach(()=>{
    state.tables.automations[0].trigger_config.session_template_fallback=true
    state.tables.automation_logs[0].created_at=new Date().toISOString()
    Object.assign(state.tables.message_templates[0],{status:'Pending',meta_status:'PENDING',body_text:'Guía {{1}}',header_type:null})
    state.tables.channel_connections=[{workspace_id:'w',channel:'whatsapp',status:'connected',health_can_send:'OK',health_blockers:[]}]
    state.tables.messages=[{id:'inbound',conversation_id:'conv',sender_type:'customer',created_at:new Date(Date.now()-3600000).toISOString()}]
  })
  it('uses the configured copy with no template send or second engine',async()=>{
    await resumePendingExecution(pendingCon({tracking_number:'RA123'}))
    expect(sendText).toHaveBeenCalledOnce()
    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({text:'Guía RA123',strictSessionWindow:true,sourceTemplateName:'rasmiaw_envio_tracking'}))
    expect(sendTemplate).not.toHaveBeenCalled()
    expect(state.tables.messages.filter(r=>r.origin==='automation')).toHaveLength(1)
  })
  it('waits on the same step when the window is closed without reserving a message',async()=>{
    state.tables.messages[0].created_at=new Date(Date.now()-25*3600000).toISOString()
    await resumePendingExecution(pendingCon({tracking_number:'RA123'}))
    expect(sendText).not.toHaveBeenCalled();expect(sendTemplate).not.toHaveBeenCalled()
    expect(state.tables.automation_pending_executions.some(r=>r.status==='pending'&&r.next_step_position===0&&r.log_id==='log')).toBe(true)
    expect(state.tables.messages).toHaveLength(1)
  })
  it('an approval cannot resend a previously delivered session message',async()=>{
    await resumePendingExecution(pendingCon({tracking_number:'RA123'}))
    Object.assign(state.tables.messages.find(r=>r.origin==='automation'),{message_id:'wamid.text',status:'sent'})
    Object.assign(state.tables.message_templates[0],{status:'Approved',meta_status:'APPROVED'})
    await resumePendingExecution(pendingCon({tracking_number:'RA123'}))
    expect(sendText).toHaveBeenCalledOnce();expect(sendTemplate).not.toHaveBeenCalled()
  })
  it('stops for a human handoff and never bypasses a mixed account block',async()=>{
    state.tables.conversations[0].needs_human_reason='refund'
    await resumePendingExecution(pendingCon({tracking_number:'RA123'}))
    expect(sendText).not.toHaveBeenCalled()
    state.tables.conversations[0].needs_human_reason=null
    Object.assign(state.tables.channel_connections[0],{health_can_send:'BLOCKED',health_blockers:[{code:141006},{code:368}]})
    await resumePendingExecution(pendingCon({tracking_number:'RA123'}))
    expect(sendText).not.toHaveBeenCalled();expect(state.tables.automation_logs[0].status).toBe('failed')
  })
  it('leaves a customer reply to Natalia, without a second automatic message',async()=>{
    state.tables.automations[0].trigger_config.stop_on_inbound=true
    state.tables.automation_logs[0].created_at=new Date(Date.now()-7200000).toISOString()
    await resumePendingExecution(pendingCon({tracking_number:'RA123'}))
    expect(sendText).not.toHaveBeenCalled();expect(sendTemplate).not.toHaveBeenCalled()
  })
})

describe('send_template con una variable vacía', () => {
  it('no llama a Meta, no reasigna la conversación y deja el motivo con la variable', async () => {
    // Rasmiaw cumple en Shopify sin guía: el pedido llega con tracking_number = ''.
    await resumePendingExecution(pendingCon({ tracking_number: '' }))
    expect(sendTemplate).not.toHaveBeenCalled()
    expect(state.tables.conversations[0].assigned_ai_agent_id).toBeNull()
    const log = state.tables.automation_logs[0]
    expect(log.status).toBe('failed')
    expect(log.error_message).toContain('rasmiaw_envio_tracking')
    expect(log.error_message).toContain('{{1}} ← {{vars.tracking_number}}')
  })

  it('con la variable cargada la plantilla sale como siempre', async () => {
    await resumePendingExecution(pendingCon({ tracking_number: 'RA123456789CO' }))
    expect(sendTemplate).toHaveBeenCalledTimes(1)
    expect(sendTemplate).toHaveBeenCalledWith(expect.objectContaining({ params: ['RA123456789CO'], templateName: 'rasmiaw_envio_tracking' }))
    expect(state.tables.automation_logs[0].status).toBe('success')
  })

  it('separates two purchased references into fixed template rows without changing delivery details', async () => {
    state.tables.message_templates.push({ workspace_id: 'w', name: 'deuna_resumen_compra_2_v1', language: 'es', status: 'Approved', category: 'Utility' })
    state.tables.automation_steps[0] = { ...envio, step_config: {
      template_name: 'deuna_resumen_compra_general_v1', language: 'es', purchase_confirmation: true,
    } }
    await resumePendingExecution(pendingCon({ recipient_name: 'Luz Mary', total_price: '249900.00', currency: 'COP',
      delivery_address: 'Cúcuta, Norte de Santander', delivery_phone: '573000000000', order_items: 'both items',
      purchase_order_lines: JSON.stringify([
        { quantity: 1, title: 'Puma', variant_title: 'Blanco / 36' },
        { quantity: 1, title: 'Puma', variant_title: 'Negro con blanco / 37' },
      ]),
    }))
    expect(sendTemplate).toHaveBeenCalledOnce()
    expect(sendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      templateName: 'deuna_resumen_compra_2_v1', params: [
        'Luz', '1 × Puma (Blanco / 36)', '1 × Puma (Negro con blanco / 37)',
        '249.900 COP', 'Cúcuta, Norte de Santander', '573000000000',
      ],
    }))
    expect(state.tables.automation_logs[0].status).toBe('success')
  })

  it('keeps the original approved confirmation while the replacement is pending', async () => {
    state.tables.automation_steps[0] = { ...envio, step_config: { ...envio.step_config, purchase_confirmation: true } }
    state.tables.message_templates.push({ workspace_id: 'w', name: 'deuna_resumen_compra_general_v1', language: 'es', status: 'Pending', category: 'Utility' })
    await resumePendingExecution(pendingCon({ tracking_number: 'existing-approved-copy' }))
    expect(sendTemplate).toHaveBeenCalledWith(expect.objectContaining({ templateName: envio.step_config.template_name, params: ['existing-approved-copy'] }))
  })

  it('la condición «guía vacía» de Rasmiaw deja la corrida en éxito sin enviar nada', async () => {
    // Estructura que quedó en producción el 2026-09-17: la plantilla cuelga
    // del camino "no" de una condición tracking_number == ''.
    state.tables.automation_steps = [
      { id: 'cond', automation_id: 'a', parent_step_id: null, branch: null, position: 0, step_type: 'condition',
        step_config: { subject: 'context_var', operand: 'tracking_number', op: 'eq', value: '' } },
      { ...envio, parent_step_id: 'cond', branch: 'no' },
    ]
    await resumePendingExecution(pendingCon({ tracking_number: '' }))
    expect(sendTemplate).not.toHaveBeenCalled()
    expect(state.tables.automation_logs[0].status).toBe('success')
    expect(state.tables.automation_logs[0].steps_executed.map((s: any) => s.detail)).toEqual(['branch=yes'])

    state.tables.automation_logs[0] = { id: 'log', status: 'partial', steps_executed: [] }
    state.tables.automation_pending_executions[0].status = 'running'
    await resumePendingExecution(pendingCon({ tracking_number: 'RA123456789CO' }))
    expect(sendTemplate).toHaveBeenCalledTimes(1)
    expect(state.tables.automation_logs[0].status).toBe('success')
  })
})
