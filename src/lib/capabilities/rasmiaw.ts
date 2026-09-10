/** Operación reproducible de Rasmiaw, sin mezclar catálogo ni políticas de Pilar. */
import { activationIssuesById } from '@/lib/automations/activation'
import type { Capability, CapabilityContext } from './types'
import { cambio, ficha, numero, tieneCampos, tt } from './vistas'

function preparacionVista(ctx: CapabilityContext, _args: Record<string, unknown>, result: unknown) {
  if (!tieneCampos(result, 'shopify', 'whatsapp', 'templates')) return null
  const r = result as Awaited<ReturnType<typeof verificarPreparacion>>
  const estado = (ready: boolean) => tt(ctx, ready ? 'operation.rasmiawListo' : 'operation.rasmiawPendiente')
  return ficha({
    titulo: tt(ctx, 'operation.rasmiawPreparacion'),
    campos: [
      { etiqueta: 'Shopify', valor: estado(r.shopify.connected) },
      { etiqueta: 'WhatsApp', valor: estado(r.whatsapp.ready) },
      { etiqueta: 'Mercado Pago', valor: estado(r.mercadopago_connected) },
      { etiqueta: tt(ctx, 'operation.rasmiawPlantillas'), valor: `${numero(ctx, r.templates.approved)} / ${numero(ctx, r.templates.expected)}` },
    ],
  })
}

function armadoVista(ctx: CapabilityContext, args: Record<string, unknown>, result?: unknown) {
  const r = result as { total?: number; group?: { total?: number } } | undefined
  const total = r?.total ?? r?.group?.total
  return cambio({
    titulo: tt(ctx, 'operation.domRasmiaw'),
    que: tt(ctx, 'operation.rasmiawPreparar'),
    aviso: tt(ctx, 'operation.rasmiawPausadas'),
    campos: total === undefined ? undefined : [{
      etiqueta: tt(ctx, 'operation.rasmiawFlujos'), despues: numero(ctx, total),
    }],
    alcance: Array.isArray(args.automation_ids) && args.automation_ids.length > 0
      ? numero(ctx, args.automation_ids.length) : undefined,
  })
}

async function previewArmado(ctx: CapabilityContext) {
  requireRasmiaw(ctx)
  return `${tt(ctx, 'operation.rasmiawPreparar')}. ${tt(ctx, 'operation.rasmiawPausadas')}`
}

const RASMIAW_WORKSPACE_ID = 'b814e934-d832-4be9-bad4-79cca51c1e23'
const TEMPLATE_NAMES = [
  'rasmiaw_preparando_pedido',
  'rasmiaw_beneficio_contraentrega_v2',
  'rasmiaw_recordatorio_contraentrega_v2',
  'rasmiaw_ultima_oportunidad_contraentrega_v2',
  'rasmiaw_carrito_abandonado_1',
  'rasmiaw_carrito_abandonado_2',
  'rasmiaw_pago_rechazado',
  'rasmiaw_envio_tracking',
] as const
const AUTOMATION_NAMES = [
  'Rasmiaw · Nuevo pedido',
  'Rasmiaw · Carrito abandonado',
  'Rasmiaw · Pago rechazado',
  'Rasmiaw · Envío',
] as const

function requireRasmiaw(ctx: CapabilityContext) {
  if (ctx.workspaceId !== RASMIAW_WORKSPACE_ID) {
    throw new Error('Esta capacidad sólo corresponde a la cuenta de Rasmiaw.')
  }
}

async function verificarPreparacion(ctx: CapabilityContext) {
  requireRasmiaw(ctx)
  const [templatesResult, automationsResult, whatsappResult, shopifyResult, productsResult, mpResult, agentsResult] = await Promise.all([
    ctx.db.from('message_templates').select('name, status, updated_at').eq('workspace_id', ctx.workspaceId).in('name', [...TEMPLATE_NAMES]),
    ctx.db.from('automations').select('id, name, is_active, activation_state, activation_blockers').eq('workspace_id', ctx.workspaceId).in('name', [...AUTOMATION_NAMES]).is('deleted_at', null),
    ctx.db.from('channel_connections').select('status, health_can_send, health_blockers, health_checked_at').eq('workspace_id', ctx.workspaceId).eq('channel', 'whatsapp').eq('status', 'connected').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    ctx.db.from('shopify_connections').select('status, connection_method, last_error, updated_at').eq('workspace_id', ctx.workspaceId).eq('status', 'active').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    ctx.db.from('shopify_products').select('price_min, price_max, url, training_material, synced_at').eq('workspace_id', ctx.workspaceId),
    ctx.db.from('workspace_integrations').select('is_active').eq('workspace_id', ctx.workspaceId).eq('provider', 'mercadopago').eq('is_active', true).maybeSingle(),
    ctx.db.from('ai_agents').select('name, is_active, assigned_only').eq('workspace_id', ctx.workspaceId).in('name', ['Rasmiaw Guía Global', 'Rasmiaw Recuperación']).is('deleted_at', null),
  ])
  for (const result of [templatesResult, automationsResult, whatsappResult, shopifyResult, productsResult, mpResult, agentsResult]) {
    if (result.error) throw new Error(result.error.message)
  }
  const templates = templatesResult.data ?? []
  const automations = automationsResult.data ?? []
  const products = productsResult.data ?? []
  const approved = new Set(templates.filter((row) => String(row.status).toLowerCase() === 'approved').map((row) => row.name))
  const whatsapp = whatsappResult.data as { health_can_send?: string | null; health_blockers?: Array<{ code?: number | null }> | null; health_checked_at?: string | null } | null
  const blockers = whatsapp?.health_blockers ?? []
  return {
    account: 'Rasmiaw',
    shopify: {
      connected: Boolean(shopifyResult.data),
      connection_method: shopifyResult.data?.connection_method ?? null,
      products_synced: products.length,
      products_with_price: products.filter((p) => p.price_min != null || p.price_max != null).length,
      products_with_url: products.filter((p) => Boolean(p.url)).length,
      latest_sync_at: products.reduce<string | null>((latest, p) => !latest || String(p.synced_at) > latest ? String(p.synced_at) : latest, null),
    },
    whatsapp: {
      ready: Boolean(whatsapp) && !blockers.some((b) => b.code === 141006) && String(whatsapp?.health_can_send ?? '').toUpperCase() !== 'BLOCKED',
      payment_blocked: blockers.some((b) => b.code === 141006),
      checked_at: whatsapp?.health_checked_at ?? null,
    },
    templates: {
      expected: TEMPLATE_NAMES.length,
      found: templates.length,
      approved: approved.size,
      pending: TEMPLATE_NAMES.filter((name) => !approved.has(name)),
    },
    mercadopago_connected: Boolean(mpResult.data),
    agents: agentsResult.data ?? [],
    automations: automations.map((row) => ({
      ...row,
      blockers: row.activation_blockers ?? [],
    })),
  }
}

async function armarGrupo(ctx: CapabilityContext, args: Record<string, unknown>) {
  requireRasmiaw(ctx)
  const requested = Array.isArray(args.automation_ids) && args.automation_ids.length > 0
    ? args.automation_ids.map(String)
    : null
  const { data, error } = await ctx.db
    .from('automations')
    .select('id, name')
    .eq('workspace_id', ctx.workspaceId)
    .in('name', [...AUTOMATION_NAMES])
    .is('deleted_at', null)
  if (error) throw new Error(error.message)
  const selected = (data ?? []).filter((row) => !requested || requested.includes(String(row.id)))
  if (selected.length === 0) throw new Error('No se encontraron las automatizaciones de Rasmiaw.')

  const armed = await Promise.all(selected.map(async (automation) => {
    const issues = await activationIssuesById(ctx.db, String(automation.id), ctx.workspaceId)
    const { error: updateError } = await ctx.db.from('automations').update({
      is_active: false,
      activation_state: 'armed',
      activation_requested_at: new Date().toISOString(),
      activation_blockers: issues.map(({ path, key, message }) => ({ path, key, message })),
    }).eq('id', automation.id).eq('workspace_id', ctx.workspaceId)
    if (updateError) throw new Error(updateError.message)
    return { id: automation.id, name: automation.name, state: 'armed' as const, issues }
  }))
  return { armed, total: armed.length }
}

async function armarOperacion(ctx: CapabilityContext) {
  const before = await verificarPreparacion(ctx)
  const group = await armarGrupo(ctx, {})
  return { before, group, note: 'Los artefactos existentes quedaron armados; no se envió ningún mensaje.' }
}

export const RASMIAW_CAPABILITIES: Capability[] = [
  {
    key: 'rasmiaw.verificar_preparacion_cuenta',
    workspaceIds: [RASMIAW_WORKSPACE_ID],
    description: 'Verifica la preparación real de Rasmiaw: Shopify, productos, salud de WhatsApp, plantillas, Mercado Pago, asistentes y estado operativo de cada flujo.',
    descriptionEn: 'Verifies Rasmiaw readiness: Shopify, products, WhatsApp health, templates, Mercado Pago, agents, and each flow operational state.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: verificarPreparacion,
    vista: preparacionVista,
  },
  {
    key: 'rasmiaw.armar_grupo_de_automatizaciones',
    workspaceIds: [RASMIAW_WORKSPACE_ID],
    description: 'Arma las automatizaciones de Rasmiaw sin encender el motor ni enviar mensajes. Guarda la dependencia exacta de cada flujo.',
    descriptionEn: 'Arms Rasmiaw automations without enabling the engine or sending messages. Stores each flow exact dependency.',
    risk: 'reversible',
    inerte: true,
    schema: { type: 'object', properties: { automation_ids: { type: 'array', items: { type: 'string' } } } },
    run: armarGrupo,
    preview: previewArmado,
    artifact: armadoVista,
  },
  {
    key: 'rasmiaw.armar_operacion_rasmiaw',
    workspaceIds: [RASMIAW_WORKSPACE_ID],
    description: 'Audita y deja armada la operación ya construida de Rasmiaw: plantillas, asistentes, reglas y los cuatro flujos. No publica, no activa ni envía.',
    descriptionEn: 'Audits and arms Rasmiaw existing operation: templates, agents, rules, and its four flows. It does not publish, activate, or send.',
    risk: 'reversible',
    inerte: true,
    schema: { type: 'object', properties: {} },
    run: armarOperacion,
    preview: previewArmado,
    artifact: armadoVista,
  },
]
