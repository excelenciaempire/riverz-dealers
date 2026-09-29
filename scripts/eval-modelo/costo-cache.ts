/**
 * Cuánto cuesta de verdad una respuesta con cada forma de cachear el prompt.
 *
 * Corre chats reales del dataset contra la API con el prompt de producción
 * (los datos de cada persona salen de su conversación: resumen, notas,
 * Shopify, trato) y cobra cada petición con `anthropicUsageCost`, la misma
 * función que descuenta del saldo. Cada chat son dos turnos: el mensaje del
 * dataset y una repregunta enseguida.
 *
 * Variantes:
 *   antes  — todo el prompt en un bloque con la caché de una hora (hasta 2026-09-29).
 *   paso1  — el mismo bloque con la caché de cinco minutos.
 *   capas  — el prompt por capas (`SystemPorCapas`), como producción ahora.
 *
 * Cada variante arranca en frío: una línea única al principio del prompt
 * impide leer lo que dejó otra variante o producción.
 *
 * No cobra saldo a nadie: el cliente es el SDK crudo con la clave de la
 * plataforma, y las herramientas corren en simulación.
 *
 * Uso:
 *   npx tsx scripts/eval-modelo/costo-cache.ts --env <archivo .env> --agent <agent_id> \
 *     [--casos 10] [--variantes antes,paso1,capas] [--output output/eval-ahorro/costo.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { arg, iniciar } from './entorno'

iniciar()

const REPREGUNTA = '¿Y cuánto tarda en llegar?'

interface Caso {
  id: string
  conversation_id?: string
  channel: string
  historial: Array<{ role: 'user' | 'assistant'; content: string }>
  mensaje: string
}

async function main() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const { createClient } = await import('@supabase/supabase-js')
  const { cargarReglas, reglasATexto } = await import('../../src/lib/ai/guidance')
  const { resolveAnthropicKey } = await import('../../src/lib/ai/platform-key')
  const runner = await import('../../src/lib/ai/runner')
  const { runWithTools } = await import('../../src/lib/ai/tools')
  const { reguladoPorEsfuerzo } = await import('../../src/lib/ai/esfuerzo')
  const { anthropicUsageCost } = await import('../../src/lib/ai/metered-fetch')
  const { resolverRegistro } = await import('../../src/lib/ai/registro-rioplatense')
  const { loadPrimaryContact } = await import('../../src/lib/contacts/dedupe')
  const { resolveStoreForLookup } = await import('../../src/lib/commerce/order-lookup')
  const { cargarPerfilOperativo } = await import('../../src/lib/operacion/perfil-operativo')
  const { resolveWorkspaceCurrency } = await import('../../src/lib/products/currency')
  const { topeDeDescuento } = await import('../../src/lib/shopify/discounts')
  type AiAgent = import('../../src/lib/ai/types').AiAgent
  type Channel = import('../../src/types').Channel
  type Contact = import('../../src/types').Contact
  type Conversation = import('../../src/types').Conversation
  type Usage = Parameters<typeof anthropicUsageCost>[1]

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: agent } = await admin.from('ai_agents').select('*').eq('id', arg('--agent', '')).maybeSingle()
  if (!agent) throw new Error('agente no encontrado')
  const a = agent as AiAgent
  const key = await resolveAnthropicKey(admin, { workspaceId: a.workspace_id, agentKeyEncrypted: a.api_key_encrypted })
  if (!key?.key || key.source === 'agent') throw new Error('sin clave de la plataforma: estas pruebas no se le cobran a nadie')
  const real = new Anthropic({ apiKey: key.key, maxRetries: 3 })
  const model = a.model || 'claude-sonnet-5-5'

  const casos = (JSON.parse(readFileSync('scripts/eval-modelo/dataset.json', 'utf8')) as Caso[])
    .filter((c) => c.conversation_id)
    .slice(0, Number(arg('--casos', '10')))
  const variantes = arg('--variantes', 'antes,paso1,capas').split(',')
  const [businessCurrency, permitidos, reglas, topeDescuento, perfilOperativo] = await Promise.all([
    resolveWorkspaceCurrency(admin, a.workspace_id),
    runner.productosPermitidos(admin, a, a.workspace_id),
    cargarReglas(admin, a.workspace_id, a.id).then(reglasATexto),
    topeDeDescuento(admin, a.workspace_id).catch(() => 0),
    cargarPerfilOperativo(admin, a.workspace_id),
  ])

  // El prompt de cada chat, con los datos de su persona, armado una vez.
  const chats = []
  for (const caso of casos) {
    const { data: conv } = await admin.from('conversations').select('*').eq('id', caso.conversation_id!).maybeSingle()
    if (!conv) continue
    const { data: contactoReal } = await admin.from('contacts').select('*').eq('id', (conv as Conversation).contact_id).maybeSingle()
    if (!contactoReal) continue
    const contacto = contactoReal as Contact
    const primario = await loadPrimaryContact(admin, contacto)
    const channel = ((conv as Conversation).channel || caso.channel || 'whatsapp') as Channel
    const [notas, contexto, registro, igContext] = await Promise.all([
      runner.loadRecentContactNotes(admin, primario.id),
      runner.loadContext(admin, conv as Conversation, 100),
      resolverRegistro({ db: admin, workspaceId: a.workspace_id, idioma: a.language, contact: contacto, primaryContact: primario }),
      runner.contextoDelTurno(admin, a, contacto, primario, { conversationId: (conv as Conversation).id, channel }),
    ])
    const productMatch =
      (await runner.detectInboundProduct(admin, a.workspace_id, caso.mensaje)) ??
      (await runner.productoUnicoAsignado(admin, a, a.workspace_id))
    const products = await runner.loadProductCatalog(admin, a, a.workspace_id, productMatch)
    const shopify = await runner.resolveShopifyContext(admin, a.workspace_id, contacto, productMatch)
    if (shopify) {
      shopify.dryRun = true
      shopify.canCreateOrders = a.puede_crear_pedidos === true
      shopify.workspaceId = a.workspace_id
      shopify.agentId = a.id
      shopify.currency = shopify.config?.currency || businessCurrency
    }
    const otraTienda = shopify ? null : await (async () => {
      const t = await resolveStoreForLookup(admin, a.workspace_id)
      return !t || t.platform === 'shopify' ? null : { ...t, customerEmail: null, customerPhone: null }
    })()
    const tools = runner.construirHerramientas({ agent: a, hayContacto: true, shopify, otherStore: otraTienda, voiceCtx: null, topeDescuento })
    const capas = runner.systemDelTurno(
      runner.armarSystemPrompt(a, contacto, primario, primario.shopify_customer_data ?? null, notas,
        { ...contexto, messages: [] }, products, productMatch, shopify, igContext, businessCurrency, reglas,
        registro, perfilOperativo, channel),
      { agent: a, recoveryContext: null, channel, traspaso: null, inboundText: caso.mensaje }
    )
    chats.push({ caso, capas, tools, shopify, otraTienda })
  }

  const informe: Record<string, unknown> = { agente: a.name, modelo: model, chats: chats.length }
  for (const variante of variantes) {
    const marca = `Prueba interna de costos ${variante} ${Date.now()}.`
    const peticiones: Array<{ chat: string; turno: number; usage: Usage; centavos: number }> = []
    let actual = { chat: '', turno: 0 }
    // Cobra cada petición como la billetera y, en `antes`, pone la caché de
    // una hora en el bloque único, como estaba hasta el 2026-09-29.
    const client = {
      messages: {
        create: async (params: import('@anthropic-ai/sdk').default.MessageCreateParamsNonStreaming) => {
          const p = variante === 'antes' && Array.isArray(params.system)
            ? { ...params, system: params.system.map((b) => b.cache_control ? { ...b, cache_control: { type: 'ephemeral' as const, ttl: '1h' as const } } : b) }
            : params
          const r = await real.messages.create(p)
          const usage = r.usage as unknown as Usage
          peticiones.push({ ...actual, usage, centavos: anthropicUsageCost(p.model, usage) * 100 })
          return r
        },
      },
    } as unknown as import('@anthropic-ai/sdk').default

    for (const chat of chats) {
      const system = variante === 'capas'
        ? { ...chat.capas, estable: `${marca}\n\n${chat.capas.estable}` }
        : `${marca}\n\n${runner.unirSystem(chat.capas)}`
      let messages: import('@anthropic-ai/sdk').default.MessageParam[] = [...chat.caso.historial, { role: 'user', content: chat.caso.mensaje }]
      for (const turno of [1, 2]) {
        actual = { chat: chat.caso.id, turno }
        const r = await runWithTools(client, {
          model,
          reasoningEffort: 'low',
          max_tokens: Math.max(64, Math.min(2048, Math.ceil((a.max_response_chars || 500) / 2))) + (reguladoPorEsfuerzo(model) ? 4000 : 0),
          system, messages, tools: chat.tools, shopify: chat.shopify, otherStore: chat.otraTienda,
          localOrders: { db: admin, workspaceId: a.workspace_id, contactId: '', agentId: a.id, permitidos, simulacion: true },
        })
        messages = [...messages, { role: 'assistant', content: r.text || '…' }, { role: 'user', content: REPREGUNTA }]
      }
      console.log(`[${variante}] ${chat.caso.id}`)
    }

    const suma = (f: (u: Usage) => number) => peticiones.reduce((n, x) => n + f(x.usage), 0)
    const respuestas = chats.length * 2
    const centavos = peticiones.reduce((n, x) => n + x.centavos, 0)
    informe[variante] = {
      peticiones: peticiones.length,
      respuestas,
      centavos_por_respuesta: +(centavos / respuestas).toFixed(3),
      centavos_primera_respuesta: +(peticiones.filter((x) => x.turno === 1).reduce((n, x) => n + x.centavos, 0) / chats.length).toFixed(3),
      centavos_repregunta: +(peticiones.filter((x) => x.turno === 2).reduce((n, x) => n + x.centavos, 0) / chats.length).toFixed(3),
      leidos: suma((u) => u.cache_read_input_tokens ?? 0),
      escritos_5m: suma((u) => (u.cache_creation_input_tokens ?? 0) - (u.cache_creation?.ephemeral_1h_input_tokens ?? 0)),
      escritos_1h: suma((u) => u.cache_creation?.ephemeral_1h_input_tokens ?? 0),
      sin_cache: suma((u) => u.input_tokens ?? 0),
      salida: suma((u) => u.output_tokens ?? 0),
      detalle: peticiones,
    }
    const resumen = { ...(informe[variante] as Record<string, unknown>), detalle: undefined }
    console.log(variante, JSON.stringify(resumen))
    writeFileSync(arg('--output', 'output/eval-ahorro/costo.json'), JSON.stringify(informe, null, 1))
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
