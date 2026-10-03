import { getAnthropic } from '@/lib/ai/anthropic-client';
import { esfuerzo } from '@/lib/ai/esfuerzo';
import { resolveAnthropicKey } from '@/lib/ai/platform-key';
import { aiBudgetGuard } from '@/lib/ai/rate-limit';
import type { AiAgent, AiResponseMode, AiTone } from '@/lib/ai/types';
import { serverError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { meteredCrawlFetch } from '@/lib/firecrawl/crawl-billing';
import type { Locale } from '@/lib/i18n/config';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { isPublicHttpsUrl } from '@/lib/security/url-guard';
import { createClient } from '@/lib/supabase/server';
import type { BillingContext } from '@/lib/wallet/operacion';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { NextResponse } from 'next/server';

/**
 * POST /api/ai/agents/generate-from-url
 *   body: { url: string, workspace_id: string }
 *
 * Onboarding "Generar con IA desde mi web". El usuario pega la URL de su
 * tienda y este endpoint:
 *   1) Scrapea hasta 30 páginas con Firecrawl (markdown, capeado a 30k chars).
 *   2) Le pasa el blob a Claude con un meta-prompt que le pide armar un
 *      JSON de configuración del agente (name, persona, tone, response_mode).
 *   3) Inserta el agente en ai_agents con knowledge ya sincronizado y lo
 *      devuelve listo para guardar.
 *
 * El flujo deja al usuario con un agente que ya "sabe" de su tienda en un
 * solo paso, sin pelearse con persona/tono/modelo a mano.
 */

const FIRECRAWL_BASE = 'https://api.firecrawl.dev';
const KNOWLEDGE_CHAR_CAP = 30_000;
const CRAWL_PAGE_LIMIT = 30;
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 90_000;

interface FirecrawlCrawlStart {
  success?: boolean;
  id?: string;
  url?: string;
  error?: string;
}

interface FirecrawlCrawlPage {
  markdown?: string;
  metadata?: { sourceURL?: string; title?: string };
}

interface FirecrawlCrawlStatus {
  status?: 'scraping' | 'completed' | 'failed' | string;
  completed?: number;
  total?: number;
  data?: FirecrawlCrawlPage[];
  error?: string;
}

interface AgentConfigSuggestion {
  name: string;
  persona: string;
  tone: AiTone;
  response_mode: AiResponseMode;
  inbound_debounce_seconds: number;
  language: string;
}

function aggregateMarkdown(pages: FirecrawlCrawlPage[]): string {
  const chunks: string[] = [];
  let total = 0;
  for (const page of pages) {
    const md = (page?.markdown ?? '').trim();
    if (!md) continue;
    const title = page?.metadata?.title ?? page?.metadata?.sourceURL ?? '';
    const header = title
      ? `# ${title}\n${page?.metadata?.sourceURL ?? ''}\n\n`
      : '';
    const block = `${header}${md}`.trim();
    if (total + block.length + 4 > KNOWLEDGE_CHAR_CAP) {
      const remaining = KNOWLEDGE_CHAR_CAP - total;
      if (remaining > 200) chunks.push(block.slice(0, remaining));
      break;
    }
    chunks.push(block);
    total += block.length + 4;
  }
  return chunks.join('\n\n---\n\n');
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function scrapeSite(
  url: string,
  locale: Locale,
  billing: BillingContext
): Promise<string> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error(translate(locale, 'errAi.firecrawlMissingKey'));
  }
  const billedFetch = meteredCrawlFetch(billing);
  const startRes = await billedFetch(`${FIRECRAWL_BASE}/v1/crawl`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      limit: CRAWL_PAGE_LIMIT,
      scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
    }),
  });
  const startJson = (await startRes
    .json()
    .catch(() => ({}))) as FirecrawlCrawlStart;
  if (!startRes.ok || !startJson?.id) {
    throw new Error(
      startJson?.error ??
        translate(locale, 'errAi.firecrawlRejectedAlt', {
          status: startRes.status,
        })
    );
  }

  const crawlId = startJson.id;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus: FirecrawlCrawlStatus | null = null;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const statusRes = await billedFetch(
        `${FIRECRAWL_BASE}/v1/crawl/${crawlId}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      );
      const json = (await statusRes
        .json()
        .catch(() => ({}))) as FirecrawlCrawlStatus;
      lastStatus = json;
      if (json.status === 'completed') break;
      if (json.status === 'failed') {
        throw new Error(
          json.error ?? translate(locale, 'errAi.firecrawlFailed')
        );
      }
    } catch {
      // transient — keep polling
    }
  }
  const pages = (lastStatus?.data ?? []) as FirecrawlCrawlPage[];
  return aggregateMarkdown(pages);
}

// El nombre y la persona se generan en el idioma del merchant (su locale de
// UI): un merchant de habla inglesa recibe un agente en inglés. NO se infiere
// del idioma de la web (esa lógica generaba español aunque el merchant
// trabajara en inglés). Nota: se quitó el "Argentine Spanish / voseo" — el
// proyecto usa español NEUTRO sin voseo.
function personaLangLabel(locale: Locale): string {
  return locale === 'en'
    ? 'natural English (en-US)'
    : 'español neutro (sin voseo)';
}

function metaSystem(locale: Locale): string {
  return [
    'You are an expert at writing AI customer service agent configurations.',
    'Only verified vehicle availability and prices come from the live dealer inventory. Do not promise credit approval, APR, monthly payments, trade-in valuations or automatic sales; request visits and hand off negotiations to the seller.',
    'Given the brand website content, produce a JSON config that captures their tone, dealership identity, buyer assistance and rules.',
    'The agent will be the brand primary voice on WhatsApp.',
    'RULES (hard, no exceptions):',
    '- No em-dashes (—). Use commas or periods.',
    '- No hashtags.',
    '- No decorative emojis.',
    '- One question per turn.',
    '- Never admit to being AI.',
    `- Write the name and persona in ${personaLangLabel(locale)}, regardless of the website language.`,
    '- Direct and warm.',
  ].join('\n');
}

const metaUser = (knowledge: string, url: string, locale: Locale) => {
  const langLabel = personaLangLabel(locale);
  return `Aquí está el contenido scrapeado de la web de la marca (${url}):

<contenido>
${knowledge.slice(0, 24_000)}
</contenido>

Devolvé ÚNICAMENTE un objeto JSON con esta forma exacta, sin texto antes ni después, sin bloques de código:

{
  "name": "string — nombre corto del agente, tipo 'Pili' o 'Asistente <Marca>'. Escríbelo en ${langLabel}.",
  "persona": "string entre 700 y 1200 caracteres — system prompt operativo, instruye al agente sobre tono, cuándo hacer preguntas, qué nunca hacer, cuándo escalar a humano. Escríbelo en ${langLabel}, sin em-dashes, sin hashtags, sin emojis decorativos, una pregunta por turno, directo, nunca admite ser IA.",
  "tone": "friendly | formal | casual | concise",
  "response_mode": "single | multi | dynamic — preferí dynamic para chat conversacional",
  "inbound_debounce_seconds": 15,
  "language": "${locale}"
}

Escribe el name y la persona SIEMPRE en ${langLabel}, sin importar el idioma de la web. NUNCA inventes productos o políticas que no estén en el contenido.`;
};

function safeParseConfig(
  text: string,
  locale: Locale
): AgentConfigSuggestion | null {
  // Strip fenced code blocks the model may add despite instructions.
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
  }
  // Find first { … last }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = cleaned.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as Partial<AgentConfigSuggestion>;
    if (!parsed.name || !parsed.persona) return null;
    const tone = ['friendly', 'formal', 'casual', 'concise'].includes(
      parsed.tone as string
    )
      ? (parsed.tone as AiTone)
      : 'friendly';
    const mode = ['single', 'multi', 'dynamic'].includes(
      parsed.response_mode as string
    )
      ? (parsed.response_mode as AiResponseMode)
      : 'dynamic';
    const debounce = Number(parsed.inbound_debounce_seconds);
    return {
      name: String(parsed.name).slice(0, 60).trim(),
      persona: String(parsed.persona).trim(),
      tone,
      response_mode: mode,
      inbound_debounce_seconds: Number.isFinite(debounce)
        ? Math.max(0, Math.min(60, debounce))
        : 15,
      // El agente habla en el idioma del merchant (lo pedimos así en el
      // prompt); forzamos el locale para que language y persona no se
      // desincronicen aunque el modelo devuelva otro valor.
      language: locale,
    };
  } catch {
    return null;
  }
}

function fallbackConfig(url: string, locale: Locale): AgentConfigSuggestion {
  let host = locale === 'en' ? 'the brand' : 'la marca';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    /* keep default */
  }
  if (locale === 'en') {
    return {
      name: 'Assistant',
      persona: [
        `You are the voice of ${host} on WhatsApp. You help customers warmly, get to the point, and answer honestly if asked whether you are an automated assistant.`,
        'You reply in natural English, no em-dashes, no hashtags, no decorative emojis. One question per turn.',
        'Understand the buyer’s vehicle preferences, budget currency and purchase timing. Consult live dealer inventory before recommending a vehicle or price; help arrange a visit with explicit agreement.',
        'If the customer is upset, wants a refund, mentions "talk to a human", or the topic is out of your scope, escalate to a human agent without arguing.',
        'Do not invent prices, promos or policies that are not in the context. If you do not know something, say so and offer to pass it to a human.',
      ].join('\n\n'),
      tone: 'friendly',
      response_mode: 'dynamic',
      inbound_debounce_seconds: 15,
      language: 'en',
    };
  }
  return {
    name: 'Asistente',
    persona: [
      `Eres la voz de ${host} en WhatsApp. Atiendes a los clientes con calidez, vas al grano y respondes con honestidad si preguntan si eres un asistente automático.`,
      'Respondes en español neutro, sin em-dashes, sin hashtags, sin emojis decorativos. Una pregunta por turno.',
      'Comprende las preferencias del comprador, su presupuesto y moneda y cuándo busca comprar. Consulta el inventario vigente antes de ofrecer vehículos o precios; coordina una visita con su acuerdo explícito.',
      'Si el cliente está molesto, quiere un reembolso, menciona "hablar con un humano" o el tema sale de tu alcance, escala a un agente humano sin discutir.',
      'No inventes precios, promociones ni políticas que no estén en el contexto. Si no sabes algo, dilo y ofrece pasarlo a un humano.',
    ].join('\n\n'),
    tone: 'friendly',
    response_mode: 'dynamic',
    inbound_debounce_seconds: 15,
    language: 'es',
  };
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, 'errAi.unauthorized') },
      { status: 401 }
    );

  const body = (await request.json().catch(() => null)) as {
    url?: string;
    workspace_id?: string;
  } | null;
  const rawUrl = body?.url?.trim();
  if (!rawUrl) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.urlWorkspaceRequired') },
      { status: 400 }
    );
  }

  // LA CUENTA LA RESUELVE EL SERVIDOR, NO EL NAVEGADOR.
  //
  // Antes era obligatoria en el cuerpo, y el asistente de alta la mandaba sin
  // ella: el paso "leé mi marca" —el único atajo que llena la persona y el
  // conocimiento del agente solo— cortaba con 400 SIEMPRE, y el comercio veía
  // un error genérico con un botón "omitir" al lado. O sea: todo comercio
  // nuevo que pasó por ahí terminó con la persona vacía.
  //
  // Pedirle al navegador un dato que el servidor ya sabe nunca fue seguridad
  // —la pertenencia se verifica igual, abajo—: era una forma de romperse.
  // Sigue aceptándose en el cuerpo para la cuenta que no es la de casa.
  const admin = supabaseAdmin();
  const workspaceId =
    body?.workspace_id?.trim() ||
    (await resolveWorkspaceIdForUser(admin, user.id));
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.urlWorkspaceRequired') },
      { status: 400 }
    );
  }
  const parsed = isPublicHttpsUrl(rawUrl);
  if (!parsed) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.urlInvalidHttps') },
      { status: 400 }
    );
  }

  const { data: member } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();
  // El dueño cuenta aunque le falte la fila de miembro. Son dos escrituras
  // distintas del alta y ya se vieron cuentas con una sola; sin esto, quien
  // creó el espacio se quedaba afuera de su propio espacio.
  const { data: duenio } = member
    ? { data: null }
    : await admin
        .from('workspaces')
        .select('id')
        .eq('id', workspaceId)
        .eq('owner_id', user.id)
        .maybeSingle();
  if (!member && !duenio)
    return NextResponse.json(
      { error: translate(locale, 'errAi.forbidden') },
      { status: 403 }
    );

  const overBudget = await aiBudgetGuard(workspaceId, 'heavy');
  if (overBudget) return overBudget;

  // 1) Scrape
  let knowledge = '';
  try {
    knowledge = await scrapeSite(parsed.toString(), locale, {
      db: admin,
      workspaceId,
      concepto: 'lectura_de_pagina',
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : translate(locale, 'errAi.scrapeFailed'),
      },
      { status: 502 }
    );
  }

  // 2) Generate config with Claude (fallback if no knowledge or AI fails).
  // La misma clave que el resto de la IA: una cuenta BYOK paga con la suya.
  const clave = await resolveAnthropicKey(admin, { workspaceId });
  let config: AgentConfigSuggestion = fallbackConfig(parsed.toString(), locale);
  if (clave && knowledge.trim().length > 200) {
    try {
      const client = getAnthropic(clave.key, {
        db: admin,
        workspaceId,
        concepto: 'ia_asistencia',
        detalle: { superficie: 'panel', para: 'generar_agente' },
        origenDeLaClave: clave.source,
      });
      const completion = await client.messages.create({
        model: 'claude-sonnet-5-5',
        max_tokens: 2000,
        ...esfuerzo('claude-sonnet-5-5'),
        system: metaSystem(locale),
        messages: [
          {
            role: 'user',
            content: metaUser(knowledge, parsed.toString(), locale),
          },
        ],
      });
      const text = completion.content
        .map((c) => ('type' in c && c.type === 'text' ? c.text : ''))
        .join('')
        .trim();
      const parsedCfg = safeParseConfig(text, locale);
      if (parsedCfg) config = parsedCfg;
    } catch (err) {
      console.warn('[generate-from-url] Claude meta-prompt failed:', err);
      // fall through with fallback config
    }
  }

  // 3) Insert ai_agent
  const now = new Date().toISOString();
  const insertPayload = {
    workspace_id: workspaceId,
    name: config.name,
    // PAUSADO. Nacía activo y con alcance de cuenta entera, o sea contestándole
    // a clientes reales con una persona que nadie había leído todavía — y sin
    // pasar por `findChannelConflict`, así que además podía quedar disputando
    // los canales con el agente que el comercio ya tenía andando. Se activa
    // aparte, después de revisarlo, por `agentes.activar`.
    is_active: false,
    persona: config.persona,
    knowledge: knowledge || null,
    knowledge_url: parsed.toString(),
    knowledge_synced_at: now,
    language: config.language,
    tone: config.tone,
    max_response_chars: 500,
    reply_delay_seconds: 0,
    context_messages: 100,
    response_mode: config.response_mode,
    inbound_debounce_seconds: config.inbound_debounce_seconds,
    reply_when_assigned: false,
    reply_outside_hours: true,
    business_hours: null,
    escalate_keywords: ['humano', 'agente', 'reembolso'],
    escalate_after_messages: 0,
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    scope: 'workspace',
    product_scope: 'all',
    priority: 0,
    created_by: user.id,
  };

  const { data: created, error } = await admin
    .from('ai_agents')
    .insert(insertPayload)
    .select()
    .single();
  if (error || !created) {
    return serverError(
      error,
      translate(locale, 'errAi.agentCreateFailed'),
      500
    );
  }

  const { data: fresh } = await admin
    .from('ai_agents')
    .select('*, ai_agent_channels(channel), ai_agent_products(product_id)')
    .eq('id', (created as AiAgent).id)
    .maybeSingle();

  const safe = (() => {
    const row = (fresh ?? created) as AiAgent;
    const { api_key_encrypted, ...rest } = row;
    return { ...rest, has_api_key: Boolean(api_key_encrypted) };
  })();

  return NextResponse.json(
    {
      agent: safe,
      was_generated: true,
      knowledge_chars: knowledge.length,
    },
    { status: 201 }
  );
}
