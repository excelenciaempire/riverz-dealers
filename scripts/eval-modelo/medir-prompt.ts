/**
 * Cuánto pesa cada parte del prompt de un asistente, en tokens.
 *
 * Arma el prompt como producción para un caso del dataset y cuenta con
 * `count_tokens`, que no se cobra: las herramientas, el system entero y cada
 * párrafo del system (proporcional a su largo dentro del total medido).
 *
 * Uso:
 *   npx tsx scripts/eval-modelo/medir-prompt.ts --env <archivo .env> --agent <agent_id> [--caso real-01]
 */
import { readFileSync } from 'node:fs'
import { arg, iniciar } from './entorno'

iniciar()

async function main() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const { createClient } = await import('@supabase/supabase-js')
  const { cargarReglas, reglasATexto } = await import('../../src/lib/ai/guidance')
  const { resolveAnthropicKey } = await import('../../src/lib/ai/platform-key')
  const runner = await import('../../src/lib/ai/runner')
  const { ORDER_CONVERSATION_POLICY, ORDER_OPERATION_POLICY } = await import('../../src/lib/ai/order-conversation-policy')
  const { secureSystemPrompt } = await import('../../src/lib/ai/input-security')
  const { resolveStoreForLookup } = await import('../../src/lib/commerce/order-lookup')
  const { cargarPerfilOperativo } = await import('../../src/lib/operacion/perfil-operativo')
  const { resolveWorkspaceCurrency } = await import('../../src/lib/products/currency')
  const { topeDeDescuento } = await import('../../src/lib/shopify/discounts')
  type AiAgent = import('../../src/lib/ai/types').AiAgent
  type Channel = import('../../src/types').Channel
  type Contact = import('../../src/types').Contact

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: agent } = await admin.from('ai_agents').select('*').eq('id', arg('--agent', '')).maybeSingle()
  if (!agent) throw new Error('agente no encontrado')
  const a = agent as AiAgent
  const key = await resolveAnthropicKey(admin, { workspaceId: a.workspace_id, agentKeyEncrypted: a.api_key_encrypted })
  if (!key?.key || key.source === 'agent') throw new Error('sin clave de la plataforma')
  const client = new Anthropic({ apiKey: key.key })

  const casos = JSON.parse(readFileSync('scripts/eval-modelo/dataset.json', 'utf8')) as Array<{ id: string; channel: string; mensaje: string }>
  const caso = casos.find((c) => c.id === arg('--caso', 'real-01'))!
  const channel = (caso.channel || 'whatsapp') as Channel
  const contacto = { id: '', workspace_id: a.workspace_id, channel, external_id: 'prueba', name: null, phone: null, email: null } as unknown as Contact
  const [businessCurrency, reglas, topeDescuento, perfilOperativo] = await Promise.all([
    resolveWorkspaceCurrency(admin, a.workspace_id),
    cargarReglas(admin, a.workspace_id, a.id).then(reglasATexto),
    topeDeDescuento(admin, a.workspace_id).catch(() => 0),
    cargarPerfilOperativo(admin, a.workspace_id),
  ])
  const productMatch =
    (await runner.detectInboundProduct(admin, a.workspace_id, caso.mensaje)) ??
    (await runner.productoUnicoAsignado(admin, a, a.workspace_id))
  const products = await runner.loadProductCatalog(admin, a, a.workspace_id, productMatch)
  const shopify = await runner.resolveShopifyContext(admin, a.workspace_id, contacto, productMatch)
  if (shopify) {
    shopify.canCreateOrders = a.puede_crear_pedidos === true
    shopify.currency = shopify.config?.currency || businessCurrency
  }
  const otraTienda = shopify ? null : await (async () => {
    const t = await resolveStoreForLookup(admin, a.workspace_id)
    return !t || t.platform === 'shopify' ? null : { ...t, customerEmail: null, customerPhone: null }
  })()
  const system = secureSystemPrompt(
    runner.buildSystemPrompt(a, contacto, contacto, null, [], { messages: [], rollingSummary: null, idleResetHint: null },
      products, productMatch, shopify, null, businessCurrency, reglas, 'neutro', perfilOperativo, channel) +
    runner.bloquesDeEntrega(a, null, channel) + '\n\n' + ORDER_CONVERSATION_POLICY + '\n\n' + ORDER_OPERATION_POLICY
  )
  const tools = runner.construirHerramientas({ agent: a, hayContacto: true, shopify, otherStore: otraTienda, voiceCtx: null, topeDescuento })

  const model = a.model || 'claude-sonnet-5-5'
  const messages = [{ role: 'user' as const, content: 'hola' }]
  const contar = async (p: { system?: string; tools?: typeof tools }) =>
    (await client.messages.countTokens({ model, messages, ...p })).input_tokens
  const base = await contar({})
  const conTools = await contar({ tools })
  const conSystem = await contar({ system })
  const todo = await contar({ system, tools })
  console.log(`agente ${a.name} · ${model} · caso ${caso.id} · producto detectado: ${productMatch?.product_id ?? 'ninguno'} (${productMatch?.via ?? '-'})`)
  console.log(`herramientas: ${tools.length}, ${conTools - base} tokens`)
  console.log(`system: ${system.length} caracteres, ${conSystem - base} tokens`)
  console.log(`total del prefijo: ${todo - base} tokens`)

  const porTool = await Promise.all(tools.map(async (t) => [
    (t as { name?: string }).name ?? '?', (await contar({ tools: [t] })) - base,
  ] as const))
  console.log('\nherramientas, de mayor a menor:')
  for (const [n, k] of porTool.sort((x, y) => y[1] - x[1])) console.log(`  ${String(k).padStart(6)}  ${n}`)

  const tokSystem = conSystem - base
  const parrafos = system.split('\n\n')
  console.log('\nsystem, párrafos de más de 150 tokens (estimado por largo):')
  for (const p of parrafos) {
    const est = Math.round((tokSystem * p.length) / system.length)
    if (est >= 150) console.log(`  ${String(est).padStart(6)}  ${p.slice(0, 90).replace(/\s+/g, ' ')}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
