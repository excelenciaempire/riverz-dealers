/**
 * Prueba A/B sobre conversaciones reales de un asistente.
 *
 * Corre el MISMO prompt, las MISMAS herramientas y el MISMO bucle que
 * producción (`armarSystemPrompt` más lo que `systemDelTurno` le suma en cada
 * turno: los bloques de entrega, las políticas de pedidos y el brief del
 * comercio, en las mismas capas de caché), sobre un dataset de conversaciones
 * reales, y guarda las respuestas lado a lado para juzgarlas.
 *
 * Compara modelos (`--modelos a,b`) o versiones del prompt: con un solo modelo
 * y `--etiqueta`, las respuestas se guardan con esa etiqueta y `unir.ts` junta
 * dos corridas en un archivo para `juez.ts`.
 *
 * No escribe en la bandeja ni en la billetera: el cliente de Anthropic es el
 * crudo del SDK (no `getAnthropic`, que cobra del saldo), y las herramientas
 * corren en `simulacion` / `dryRun`, que cortan todo lo que deja huella.
 *
 * Uso:
 *   npx tsx scripts/eval-modelo/run.ts --env <archivo .env> --agent <agent_id> \
 *     [--modelos claude-sonnet-5-5] [--etiqueta antes] [--limit 40] [--max 52] [--sin-politicas-de-pedidos] \
 *     [--dataset scripts/eval-modelo/dataset.json] [--output scripts/eval-modelo/resultados.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { arg, iniciar } from './entorno'

iniciar()

const agentId = arg('--agent', '')
const models = arg('--modelos', arg('--models', 'claude-sonnet-5-5')).split(',')
const etiqueta = arg('--etiqueta', '')
const sinPoliticas = process.argv.includes('--sin-politicas-de-pedidos')
const limit = Number(arg('--limit', '40'))
const datasetPath = arg('--dataset', 'scripts/eval-modelo/dataset.json')
const output = arg('--output', 'scripts/eval-modelo/resultados.json')
if (!agentId) throw new Error('--agent <id> es obligatorio')
if (etiqueta && models.length !== 1) throw new Error('--etiqueta va con un solo modelo')

interface Caso {
  id: string
  channel: string
  historial: Array<{ role: 'user' | 'assistant'; content: string }>
  mensaje: string
  respuesta_original: string | null
  herramientas_originales: string[] | null
}

async function main() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const { createClient } = await import('@supabase/supabase-js')
  const { cargarReglas, reglasATexto } = await import('../../src/lib/ai/guidance')
  const { resolveAnthropicKey } = await import('../../src/lib/ai/platform-key')
  const runner = await import('../../src/lib/ai/runner')
  const { nombresDeHerramientas, runWithTools } = await import('../../src/lib/ai/tools')
  const { reguladoPorEsfuerzo } = await import('../../src/lib/ai/esfuerzo')
  const { resolveStoreForLookup } = await import('../../src/lib/commerce/order-lookup')
  const { cargarPerfilOperativo } = await import('../../src/lib/operacion/perfil-operativo')
  const { resolveWorkspaceCurrency } = await import('../../src/lib/products/currency')
  const { topeDeDescuento } = await import('../../src/lib/shopify/discounts')
  type AiAgent = import('../../src/lib/ai/types').AiAgent
  type Channel = import('../../src/types').Channel
  type Contact = import('../../src/types').Contact

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data: agent } = await admin.from('ai_agents').select('*').eq('id', agentId).maybeSingle()
  if (!agent) throw new Error('agente no encontrado')
  const a = agent as AiAgent
  const resolved = await resolveAnthropicKey(admin, {
    workspaceId: a.workspace_id,
    agentKeyEncrypted: a.api_key_encrypted,
  })
  if (!resolved?.key) throw new Error('sin clave de Anthropic')
  if (resolved.source === 'agent') throw new Error('la clave es del comercio: estas pruebas no se le cobran a nadie')
  const client = new Anthropic({ apiKey: resolved.key, maxRetries: 3 })

  const todos = JSON.parse(readFileSync(datasetPath, 'utf8')) as Caso[]
  const reales = todos.filter((c) => c.id.startsWith('real')).slice(0, limit)
  const adversariales = todos.filter((c) => !c.id.startsWith('real'))
  const casos = [...reales, ...adversariales].slice(0, Number(arg('--max', '1000')))
  const claves = etiqueta ? [etiqueta] : models
  console.log(`agente: ${a.name} (${a.model}); casos: ${casos.length}; modelos: ${models.join(', ')}${etiqueta ? `; etiqueta: ${etiqueta}` : ''}`)

  const [businessCurrency, permitidos, reglas, topeDescuento, perfilOperativo] = await Promise.all([
    resolveWorkspaceCurrency(admin, a.workspace_id),
    runner.productosPermitidos(admin, a, a.workspace_id),
    cargarReglas(admin, a.workspace_id, a.id).then(reglasATexto),
    topeDeDescuento(admin, a.workspace_id).catch(() => 0),
    cargarPerfilOperativo(admin, a.workspace_id),
  ])

  // Reanudable: lo ya hecho se conserva y se saltea.
  let resultados: Array<Record<string, unknown>> = []
  try { resultados = (JSON.parse(readFileSync(output, 'utf8')) as { resultados: typeof resultados }).resultados ?? [] } catch { /* primera corrida */ }
  const hechos = new Set(resultados.map((r) => r.id as string))
  const gasto: Record<string, { prompt: number; salida: number; cacheR: number; cacheW: number; n: number; ms: number }> = {}
  for (const k of claves) gasto[k] = { prompt: 0, salida: 0, cacheR: 0, cacheW: 0, n: 0, ms: 0 }

  for (const [i, caso] of casos.entries()) {
    if (hechos.has(caso.id)) continue
    const channel = (caso.channel || 'whatsapp') as Channel
    const contacto = {
      id: '',
      workspace_id: a.workspace_id,
      channel,
      external_id: 'prueba',
      name: null,
      phone: null,
      email: null,
    } as unknown as Contact
    const detectado = await runner.detectInboundProduct(admin, a.workspace_id, caso.mensaje)
    const productMatch = detectado ?? (await runner.productoUnicoAsignado(admin, a, a.workspace_id))
    const products = await runner.loadProductCatalog(admin, a, a.workspace_id, productMatch)
    const shopify = await runner.resolveShopifyContext(admin, a.workspace_id, contacto, productMatch)
    if (shopify) {
      shopify.dryRun = true
      shopify.canCreateOrders = a.puede_crear_pedidos === true
      shopify.workspaceId = a.workspace_id
      shopify.agentId = a.id
      shopify.currency = shopify.config?.currency || businessCurrency
    }
    const otraTienda = shopify
      ? null
      : await (async () => {
          const t = await resolveStoreForLookup(admin, a.workspace_id)
          if (!t || t.platform === 'shopify') return null
          return { ...t, customerEmail: null, customerPhone: null }
        })()
    const tools = runner.construirHerramientas({
      agent: a, hayContacto: true, shopify, otherStore: otraTienda, voiceCtx: null, topeDescuento,
    })
    // Los clientes de este comercio son argentinos: el runner resuelve
    // `rioplatense` por el país del cliente. Se fija acá para no pedir el país.
    // Lo demás es lo que `generateReply` le suma en cada turno, en sus capas.
    const system = runner.systemDelTurno(
      runner.armarSystemPrompt(
        a, contacto, contacto, null, [],
        { messages: [], rollingSummary: null, idleResetHint: null },
        products, productMatch, shopify, null, businessCurrency, reglas,
        'rioplatense', perfilOperativo, channel
      ),
      {
        agent: a, recoveryContext: null, channel, traspaso: null, inboundText: caso.mensaje,
        // `--sin-politicas-de-pedidos`: como un agente sin herramientas de pedidos.
        herramientas: sinPoliticas ? [] : nombresDeHerramientas(tools),
      }
    )
    const messages = [...caso.historial, { role: 'user' as const, content: caso.mensaje }]
    const fila: Record<string, unknown> = {
      id: caso.id, channel, mensaje: caso.mensaje, historial: caso.historial,
      respuesta_original: caso.respuesta_original, herramientas_originales: caso.herramientas_originales,
      system_chars: runner.unirSystem(system).length,
    }
    await Promise.all(models.map(async (model, k) => {
      const t0 = Date.now()
      const clave = claves[k]
      try {
        const r = await runWithTools(client, {
          model,
          reasoningEffort: model === 'claude-opus-5' ? 'high' : 'low',
          max_tokens: Math.max(64, Math.min(2048, Math.ceil((a.max_response_chars || 500) / 2))) + (reguladoPorEsfuerzo(model) ? 4000 : 0),
          system, messages, tools, shopify, otherStore: otraTienda,
          localOrders: { db: admin, workspaceId: a.workspace_id, contactId: '', agentId: a.id, permitidos, simulacion: true },
        })
        const g = gasto[clave]
        g.prompt += r.promptTokens; g.salida += r.completionTokens; g.cacheR += r.cacheReadTokens; g.cacheW += r.cacheWriteTokens; g.n += 1; g.ms += Date.now() - t0
        fila[clave] = { texto: r.text, herramientas: r.herramientas, iteraciones: r.iterations, truncada: r.truncated,
          tokens: { prompt: r.promptTokens, salida: r.completionTokens, cacheR: r.cacheReadTokens, cacheW: r.cacheWriteTokens }, ms: Date.now() - t0 }
      } catch (err) {
        fila[clave] = { error: err instanceof Error ? err.message.slice(0, 300) : String(err) }
      }
    }))
    resultados.push(fila)
    console.log(`[${i + 1}/${casos.length}] ${caso.id}`)
    writeFileSync(output, JSON.stringify({ agente: a.name, modelos: claves, gasto, resultados }, null, 1))
  }
  console.log('gasto:', JSON.stringify(gasto))
}

main().catch((e) => { console.error(e); process.exit(1) })
