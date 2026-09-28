/**
 * Prueba A/B de modelo sobre conversaciones reales de un asistente.
 *
 * Corre el MISMO prompt, las MISMAS herramientas y el MISMO bucle que
 * producción (`buildSystemPrompt` + `construirHerramientas` + `runWithTools`,
 * igual que /api/ai/agents/[id]/test) contra varios modelos, sobre un dataset
 * de conversaciones reales, y guarda las respuestas lado a lado para juzgarlas.
 *
 * No escribe en la bandeja ni en la billetera: el cliente de Anthropic es el
 * crudo del SDK (no `getAnthropic`, que tarifa), y las herramientas corren en
 * `simulacion` / `dryRun`, que cortan todo lo que deja huella.
 *
 * Uso:
 *   node --env-file=.env.local --import tsx scripts/eval-modelo/run.ts \
 *     --agent <agent_id> [--models claude-opus-5,claude-sonnet-5-5] [--limit 40] \
 *     [--dataset scripts/eval-modelo/dataset.json] [--output scripts/eval-modelo/resultados.json]
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { cargarReglas, reglasATexto } from '../../src/lib/ai/guidance';
import { resolveAnthropicKey } from '../../src/lib/ai/platform-key';
import {
  buildSystemPrompt,
  construirHerramientas,
  detectInboundProduct,
  loadProductCatalog,
  productosPermitidos,
  resolveShopifyContext,
} from '../../src/lib/ai/runner';
import { runWithTools } from '../../src/lib/ai/tools';
import type { AiAgent } from '../../src/lib/ai/types';
import { resolveStoreForLookup } from '../../src/lib/commerce/order-lookup';
import { cargarPerfilOperativo } from '../../src/lib/operacion/perfil-operativo';
import { resolveWorkspaceCurrency } from '../../src/lib/products/currency';
import { topeDeDescuento } from '../../src/lib/shopify/discounts';
import type { Channel, Contact } from '../../src/types';

const arg = (name: string, def: string) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : def;
const agentId = arg('--agent', '');
const models = arg('--models', 'claude-opus-5,claude-sonnet-5-5').split(',');
const limit = Number(arg('--limit', '40'));
const datasetPath = arg('--dataset', 'scripts/eval-modelo/dataset.json');
const output = arg('--output', 'scripts/eval-modelo/resultados.json');
if (!agentId) throw new Error('--agent <id> es obligatorio');

interface Caso {
  id: string;
  channel: string;
  historial: Array<{ role: 'user' | 'assistant'; content: string }>;
  mensaje: string;
  respuesta_original: string | null;
  herramientas_originales: string[] | null;
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const { data: agent } = await admin.from('ai_agents').select('*').eq('id', agentId).maybeSingle();
  if (!agent) throw new Error('agente no encontrado');
  const a = agent as AiAgent;
  const resolved = await resolveAnthropicKey(admin, {
    workspaceId: a.workspace_id,
    agentKeyEncrypted: a.api_key_encrypted,
  });
  if (!resolved?.key) throw new Error('sin clave de Anthropic');
  const client = new Anthropic({ apiKey: resolved.key, maxRetries: 3 });

  const todos = JSON.parse(readFileSync(datasetPath, 'utf8')) as Caso[];
  const reales = todos.filter((c) => c.id.startsWith('real')).slice(0, limit);
  const adversariales = todos.filter((c) => !c.id.startsWith('real'));
  const casos = [...reales, ...adversariales];
  console.log(`agente: ${a.name} (${a.model}); casos: ${casos.length}; modelos: ${models.join(', ')}`);

  const [businessCurrency, permitidos, reglas, topeDescuento, perfilOperativo] = await Promise.all([
    resolveWorkspaceCurrency(admin, a.workspace_id),
    productosPermitidos(admin, a, a.workspace_id),
    cargarReglas(admin, a.workspace_id, a.id).then(reglasATexto),
    topeDeDescuento(admin, a.workspace_id).catch(() => 0),
    cargarPerfilOperativo(admin, a.workspace_id),
  ]);

  // Reanudable: lo ya hecho se conserva y se saltea.
  let resultados: Array<Record<string, unknown>> = [];
  try { resultados = (JSON.parse(readFileSync(output, 'utf8')) as { resultados: typeof resultados }).resultados ?? []; } catch { /* primera corrida */ }
  const hechos = new Set(resultados.map((r) => r.id as string));
  const gasto: Record<string, { prompt: number; salida: number; cacheR: number; cacheW: number; n: number; ms: number }> = {};
  for (const m of models) gasto[m] = { prompt: 0, salida: 0, cacheR: 0, cacheW: 0, n: 0, ms: 0 };

  for (const [i, caso] of casos.entries()) {
    if (hechos.has(caso.id)) continue;
    const channel = (caso.channel || 'whatsapp') as Channel;
    const contacto = {
      id: '',
      workspace_id: a.workspace_id,
      channel,
      external_id: 'prueba',
      name: null,
      phone: null,
      email: null,
    } as unknown as Contact;
    const productMatch = await detectInboundProduct(admin, a.workspace_id, caso.mensaje);
    const products = await loadProductCatalog(admin, a, a.workspace_id, productMatch);
    const shopify = await resolveShopifyContext(admin, a.workspace_id, contacto, productMatch);
    if (shopify) {
      shopify.dryRun = true;
      shopify.canCreateOrders = a.puede_crear_pedidos === true;
      shopify.workspaceId = a.workspace_id;
      shopify.agentId = a.id;
      shopify.currency = shopify.config?.currency || businessCurrency;
    }
    const otraTienda = shopify
      ? null
      : await (async () => {
          const t = await resolveStoreForLookup(admin, a.workspace_id);
          if (!t || t.platform === 'shopify') return null;
          return { ...t, customerEmail: null, customerPhone: null };
        })();
    // Los clientes de este comercio son argentinos: el runner resuelve
    // `rioplatense` por el país del cliente. Se fija acá para no pedir el país.
    const system = buildSystemPrompt(
      a, contacto, contacto, null, [],
      { messages: [], rollingSummary: null, idleResetHint: null },
      products, productMatch, shopify, null, businessCurrency, reglas,
      'rioplatense', perfilOperativo, channel
    );
    const tools = construirHerramientas({
      agent: a, hayContacto: true, shopify, otherStore: otraTienda, voiceCtx: null, topeDescuento,
    });
    const messages = [...caso.historial, { role: 'user' as const, content: caso.mensaje }];
    const fila: Record<string, unknown> = {
      id: caso.id, channel, mensaje: caso.mensaje, historial: caso.historial,
      respuesta_original: caso.respuesta_original, herramientas_originales: caso.herramientas_originales,
      system_chars: system.length,
    };
    await Promise.all(models.map(async (model) => {
      const t0 = Date.now();
      try {
        const r = await runWithTools(client, {
          model,
          max_tokens: Math.max(64, Math.min(2048, Math.ceil((a.max_response_chars || 500) / 2))) + (/haiku/.test(model) ? 0 : 4000),
          system, messages, tools, shopify, otherStore: otraTienda,
          localOrders: { db: admin, workspaceId: a.workspace_id, contactId: '', agentId: a.id, permitidos, simulacion: true },
        });
        const g = gasto[model];
        g.prompt += r.promptTokens; g.salida += r.completionTokens; g.cacheR += r.cacheReadTokens; g.cacheW += r.cacheWriteTokens; g.n += 1; g.ms += Date.now() - t0;
        fila[model] = { texto: r.text, herramientas: r.herramientas, iteraciones: r.iterations, truncada: r.truncated,
          tokens: { prompt: r.promptTokens, salida: r.completionTokens, cacheR: r.cacheReadTokens, cacheW: r.cacheWriteTokens }, ms: Date.now() - t0 };
      } catch (err) {
        fila[model] = { error: err instanceof Error ? err.message.slice(0, 300) : String(err) };
      }
    }));
    resultados.push(fila);
    console.log(`[${i + 1}/${casos.length}] ${caso.id}`);
    writeFileSync(output, JSON.stringify({ agente: a.name, modelos: models, gasto, resultados }, null, 1));
  }
  console.log('gasto por modelo:', JSON.stringify(gasto));
}

main().catch((e) => { console.error(e); process.exit(1); });
