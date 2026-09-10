/*
 * Idempotent local provisioning for the Rasmiaw account.
 *
 * It only creates local drafts and paused automations/agent. It never calls
 * Meta, activates an automation, sends a message, or creates a Shopify coupon.
 * Run after the SQL migrations:
 *   node scripts/provision-rasmiaw.mjs
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const WORKSPACE_ID = 'b814e934-d832-4be9-bad4-79cca51c1e23'

function envFile() {
  const values = {}
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}

const env = envFile()
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const fail = (error) => {
  if (error) throw new Error(error.message)
}
const siteBase = /^https:\/\//i.test(env.NEXT_PUBLIC_SITE_URL ?? '') &&
  !/localhost|127\.0\.0\.1/i.test(env.NEXT_PUBLIC_SITE_URL ?? '')
  ? env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '')
  : 'https://riverz.co'
// Meta only accepts a variable at the end of a fixed HTTPS URL. The token is
// resolved per contact by the engine and redirects to the Shopify checkout.
const dynamicCheckoutButtonUrl = `${siteBase}/r/{{1}}`

const templates = [
  {
    name: 'rasmiaw_preparando_pedido', category: 'Utility', body: `¡Estamos preparando tu pedido de Rasmiaw! 💛

Queremos contarte que tu pedido de Rasmiaw está en proceso de alistamiento y personalización 🎨🐾

Cada rascador lo hacemos especialmente para ti, eligiendo colores y juguetes con mucho cuidado, por eso nos toma unos días dejarlo perfecto ✨

Te estaremos enviando un mensaje tan pronto esté listo, preparado y despachado 🚚

¡Gracias por tu paciencia y por apoyar lo hecho con amor! 💛

Si tienes alguna pregunta escríbenos por este medio`,
  },
  {
    name: 'rasmiaw_beneficio_contraentrega_v2', category: 'Marketing', body: `🎈 ¡Tenemos un beneficio para ti!

Si cambias tu forma de pago y eliges pagar por Transferencia, Llave, Bold o Addi, recibirás un 5% de descuento en tu compra. 💛

Así podremos gestionar tu pedido más rápido, evitar retrasos y lograr que tu michi disfrute de su rascador lo antes posible. 😻

Responde “RECIBIR BENEFICIO” para cambiar el método de pago.

Responde “MANTENER CONTRAENTREGA” si prefieres conservar tu pago contra entrega.`,
    buttons: [{ type: 'QUICK_REPLY', text: 'RECIBIR BENEFICIO' }, { type: 'QUICK_REPLY', text: 'MANTENER CONTRAENTREGA' }],
  },
  {
    name: 'rasmiaw_recordatorio_contraentrega_v2', category: 'Marketing', body: `¿Te ayudamos a finalizar tu pedido? 😻

Aprovecha tu 5% de descuento y recibe tu Rasmiaw sin complicaciones. 💛

Responde “RECIBIR BENEFICIO” para cambiar tu método de pago y aplicar el descuento.

Responde “MANTENER CONTRAENTREGA” si prefieres conservar tu pago contra entrega.`,
    buttons: [{ type: 'QUICK_REPLY', text: 'RECIBIR BENEFICIO' }, { type: 'QUICK_REPLY', text: 'MANTENER CONTRAENTREGA' }],
  },
  {
    name: 'rasmiaw_ultima_oportunidad_contraentrega_v2', category: 'Marketing', body: `🚨 ¡Última oportunidad!

Subimos tu beneficio al 10% de descuento 🎉, este beneficio es por tiempo limitado.

Si quieres aprovecharlo, responde “RECIBIR BENEFICIO” y te ayudaremos a finalizar tu compra.

Si prefieres mantener tu pedido original, responde “MANTENER CONTRAENTREGA” para conservar tu pago contra entrega.

Válido durante las próximas 24 horas. 🏃`,
    buttons: [{ type: 'QUICK_REPLY', text: 'RECIBIR BENEFICIO' }, { type: 'QUICK_REPLY', text: 'MANTENER CONTRAENTREGA' }],
  },
  {
    name: 'rasmiaw_carrito_abandonado_1', category: 'Marketing', body: `¡No dejes que se te escape!

Nuestro rascador te ayudará a que tu gato desgaste sus uñas, libere estrés, se mantenga activo y tenga su propio espacio para rascar, jugar y descansar. 😻

Completa tu compra de forma fácil y rápida y vive la experiencia Rasmiaw.`,
    buttons: [{ type: 'URL', text: 'Volver a mi carrito', url: dynamicCheckoutButtonUrl, url_variable: 'product' }],
  },
  {
    name: 'rasmiaw_carrito_abandonado_2', category: 'Marketing', body: `¡Tu michi todavía está esperando!

Retoma tu carrito y obtén un 10% de descuento por completar tu compra. 🎉

¡No dejes que se te escape!

Aquí puedes completar tu compra de forma fácil y rápida…`,
    buttons: [{ type: 'URL', text: 'Completar con 10% OFF', url: dynamicCheckoutButtonUrl, url_variable: 'abandoned_checkout' }],
  },
  {
    name: 'rasmiaw_pago_rechazado', category: 'Utility', body: `¡Ups! Algo salió mal con tu pago. 😿

No pudimos procesar tu pedido a través de Mercado Pago, pero no te preocupes, ¡tu carrito sigue esperándote! 😻

Responde este mensaje y te ofreceremos otras formas de pago para que puedas completar tu compra fácilmente.`,
  },
  {
    name: 'rasmiaw_envio_tracking', category: 'Utility', body: `Me da gusto saludarte,

Te informo, que tu Rasmiaw va en camino hacia tu 🏠!

Envío guía: {{1}}

Si tienes alguna pregunta escríbenos por este medio`,
    samples: ['RA123456789CO'], variable_fields: { '1': 'tracking_number' },
  },
]

const template = (name, variables = {}) => ({
  step_type: 'send_template', step_config: { template_name: name, language: 'es', variables },
})
const wait = (amount, unit) => ({ step_type: 'wait', step_config: { amount, unit } })
const context = (values) => ({ step_type: 'set_context', step_config: { values } })
const condition = (step_config, yes, no) => ({ step_type: 'condition', step_config, branches: { yes, no } })

async function seedSteps(automationId, tree) {
  const rows = []
  const walk = (steps, parent = null, branch = null) => steps.forEach((step, position) => {
    const id = crypto.randomUUID()
    rows.push({ id, automation_id: automationId, parent_step_id: parent, branch, position, step_type: step.step_type, step_config: step.step_config })
    if (step.branches) {
      walk(step.branches.yes ?? [], id, 'yes')
      walk(step.branches.no ?? [], id, 'no')
    }
  })
  walk(tree)
  const { error } = await db.from('automation_steps').insert(rows)
  fail(error)
}

async function upsertAutomation(ownerId, agentId, definition) {
  const { data: existing, error: lookupError } = await db.from('automations')
    .select('id').eq('workspace_id', WORKSPACE_ID).eq('name', definition.name).is('deleted_at', null).maybeSingle()
  fail(lookupError)
  const payload = {
    workspace_id: WORKSPACE_ID, user_id: ownerId, name: definition.name,
    description: definition.description, trigger_type: definition.trigger_type,
    trigger_config: { ...definition.trigger_config, handoff_ai_agent_id: agentId }, is_active: false,
  }
  const { data: automation, error } = existing
    ? await db.from('automations').update(payload).eq('id', existing.id).select('id').single()
    : await db.from('automations').insert(payload).select('id').single()
  fail(error)
  const { error: deleteError } = await db.from('automation_steps').delete().eq('automation_id', automation.id)
  fail(deleteError)
  await seedSteps(automation.id, definition.steps)
}

async function main() {
  const { data: members, error: memberError } = await db.from('workspace_members')
    .select('user_id, role').eq('workspace_id', WORKSPACE_ID).limit(1)
  fail(memberError)
  const ownerId = members?.[0]?.user_id
  if (!ownerId) throw new Error('No se encontró el propietario de Rasmiaw.')

  for (const item of templates) {
    const { data: old, error: oldError } = await db.from('message_templates')
      .select('id, status').eq('workspace_id', WORKSPACE_ID).eq('name', item.name).eq('language', 'es').maybeSingle()
    fail(oldError)
    // Never overwrite a submitted/approved template. Drafts are safe to keep
    // in sync with the definitive copy.
    if (old && String(old.status).toLowerCase() !== 'draft') continue
    const payload = {
      workspace_id: WORKSPACE_ID, user_id: ownerId, name: item.name, language: 'es', category: item.category,
      body_text: item.body, buttons: item.buttons ?? null, variable_samples: item.samples ?? null,
      variable_fields: item.variable_fields ?? null, status: 'Draft', meta_template_id: null,
      rejected_reason: null, updated_at: new Date().toISOString(),
    }
    const { error } = old
      ? await db.from('message_templates').update(payload).eq('id', old.id)
      : await db.from('message_templates').insert(payload)
    fail(error)
  }

  const { data: existingAgent, error: agentLookupError } = await db.from('ai_agents')
    .select('id').eq('workspace_id', WORKSPACE_ID).eq('name', 'Rasmiaw Recuperación').maybeSingle()
  fail(agentLookupError)
  const agentPayload = {
    workspace_id: WORKSPACE_ID, name: 'Rasmiaw Recuperación', is_active: false, assigned_only: true,
    role: 'recuperacion', scope: 'channels', language: 'es', tone: 'friendly', reply_when_assigned: true, max_response_chars: 1200,
    persona: 'Recuperas compras asignadas con claridad y calidez. Confirmar conserva contra entrega. En un pedido ya creado, BENEFICIO o RECIBIR BENEFICIO solicita cambiar la forma de pago actual: presentas el menú de pago personalizado declarado por Rasmiaw sin generar cupón ni otro checkout. Escalas cuando elija Bold o Addi, envíe un comprobante o reporte un problema. Sólo generas cupón cuando una recuperación sin pedido existente lo autorizó. No inventas datos de pago.',
    permissions: { crear_checkout: true }, tools: { crear_checkout: 'auto', ofrecer_descuento: 'off', registrar_pago: 'off' },
    medios_pago: ['transferencia', 'link_de_pago'], created_by: ownerId,
  }
  const { data: agent, error: agentError } = existingAgent
    ? await db.from('ai_agents').update(agentPayload).eq('id', existingAgent.id).select('id').single()
    : await db.from('ai_agents').insert(agentPayload).select('id').single()
  fail(agentError)
  const { error: channelError } = await db.from('ai_agent_channels').upsert({ agent_id: agent.id, channel: 'whatsapp' })
  fail(channelError)

  const { error: configError } = await db.from('workspace_checkout_config').upsert({
    workspace_id: WORKSPACE_ID, max_discount_percent: 10,
  }, { onConflict: 'workspace_id' })
  fail(configError)

  const flows = [
    {
      name: 'Rasmiaw · Nuevo pedido', description: 'Pedido pagado o contra entrega; se detiene cuando el cliente responde.',
      trigger_type: 'shopify_order_created', trigger_config: { stop_on_inbound: true },
      steps: [condition({ subject: 'context_var', operand: 'financial_status', value: 'paid' },
        [template('rasmiaw_preparando_pedido')],
        [condition({ subject: 'context_var', operand: 'financial_status', value: 'pending' }, [
          template('rasmiaw_preparando_pedido'), wait(3, 'seconds'),
          template('rasmiaw_beneficio_contraentrega_v2'), context({ benefit_percent: 5 }), wait(3, 'hours'),
          template('rasmiaw_recordatorio_contraentrega_v2'), wait(24, 'hours'), context({ benefit_percent: 10 }),
          template('rasmiaw_ultima_oportunidad_contraentrega_v2'), wait(24, 'hours'),
        ], [])])],
    },
    {
      name: 'Rasmiaw · Carrito abandonado', description: 'Recupera un carrito sólo si no hubo compra ni pago rechazado.',
      trigger_type: 'shopify_abandoned_checkout', trigger_config: {},
      steps: [wait(1, 'hours'), condition({ subject: 'rejected_open', operand: 'since_trigger', value: 'true' }, [], [
        condition({ subject: 'purchased', operand: 'since_trigger', value: 'true' }, [], [
          template('rasmiaw_carrito_abandonado_1'), wait(23, 'hours'),
          condition({ subject: 'purchased', operand: 'since_trigger', value: 'true' }, [], [template('rasmiaw_carrito_abandonado_2')]),
        ]),
      ])],
    },
    {
      name: 'Rasmiaw · Pago rechazado', description: 'Avisa el rechazo y entrega la conversación al asistente asignado. Requiere Mercado Pago.',
      trigger_type: 'payment_rejected', trigger_config: { stop_on_inbound: true, requires_integration: 'mercadopago' },
      steps: [template('rasmiaw_pago_rechazado'), context({ benefit_percent: 5 }), wait(24, 'hours')],
    },
    {
      name: 'Rasmiaw · Envío', description: 'Envía la guía al cumplirse el pedido.',
      trigger_type: 'shopify_order_fulfilled', trigger_config: {},
      steps: [template('rasmiaw_envio_tracking', { '1': '{{vars.tracking_number}}' })],
    },
  ]
  for (const flow of flows) await upsertAutomation(ownerId, agent.id, flow)
  console.log(JSON.stringify({ ok: true, templates: templates.length, automations: flows.length, agent: agent.id }))
}

await main()
