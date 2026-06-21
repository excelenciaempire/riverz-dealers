import { NextResponse } from 'next/server';
import { getAnthropic } from '@/lib/ai/anthropic-client';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { isPublicHttpsUrl } from '@/lib/security/url-guard';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';
import type { AiAgent, AiResponseMode, AiTone } from '@/lib/ai/types';

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
    const header = title ? `# ${title}\n${page?.metadata?.sourceURL ?? ''}\n\n` : '';
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

async function scrapeSite(url: string, locale: Locale): Promise<string> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error(translate(locale, 'errAi.firecrawlMissingKey'));
  }
  const startRes = await fetch(`${FIRECRAWL_BASE}/v1/crawl`, {
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
  const startJson = (await startRes.json().catch(() => ({}))) as FirecrawlCrawlStart;
  if (!startRes.ok || !startJson?.id) {
    throw new Error(
      startJson?.error ??
        translate(locale, 'errAi.firecrawlRejectedAlt', { status: startRes.status }),
    );
  }

  const crawlId = startJson.id;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus: FirecrawlCrawlStatus | null = null;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const statusRes = await fetch(`${FIRECRAWL_BASE}/v1/crawl/${crawlId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const json = (await statusRes.json().catch(() => ({}))) as FirecrawlCrawlStatus;
      lastStatus = json;
      if (json.status === 'completed') break;
      if (json.status === 'failed') {
        throw new Error(json.error ?? translate(locale, 'errAi.firecrawlFailed'));
      }
    } catch {
      // transient — keep polling
    }
  }
  const pages = (lastStatus?.data ?? []) as FirecrawlCrawlPage[];
  return aggregateMarkdown(pages);
}

const META_SYSTEM = [
  'You are an expert at writing AI customer service agent configurations.',
  'Given the brand website content, produce a JSON config that captures their tone, products, brand voice and rules.',
  'The agent will be the brand primary voice on WhatsApp.',
  'RULES (hard, no exceptions):',
  '- No em-dashes (—). Use commas or periods.',
  '- No hashtags.',
  '- No decorative emojis.',
  '- One question per turn.',
  '- Never admit to being AI.',
  '- Argentine Spanish, neutral rioplatense, no voseo agresivo.',
  '- Direct and warm.',
].join('\n');

const META_USER_TEMPLATE = (knowledge: string, url: string) => `Aquí está el contenido scrapeado de la web de la marca (${url}):

<contenido>
${knowledge.slice(0, 24_000)}
</contenido>

Devolvé ÚNICAMENTE un objeto JSON con esta forma exacta, sin texto antes ni después, sin bloques de código:

{
  "name": "string — nombre corto del agente, tipo 'Pili' o 'Asistente <Marca>'",
  "persona": "string entre 700 y 1200 caracteres — system prompt operativo, instruye al agente sobre tono, cuándo hacer preguntas, qué nunca hacer, cuándo escalar a humano. Argentine Spanish neutral rioplatense, sin em-dashes, sin hashtags, sin emojis decorativos, una pregunta por turno, directo, nunca admite ser IA.",
  "tone": "friendly | formal | casual | concise",
  "response_mode": "single | multi | dynamic — preferí dynamic para chat conversacional",
  "inbound_debounce_seconds": 15,
  "language": "es"
}

Si la web está en otro idioma, ajustá language y persona pero NUNCA inventes productos o políticas que no estén en el contenido.`;

function safeParseConfig(text: string): AgentConfigSuggestion | null {
  // Strip fenced code blocks the model may add despite instructions.
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  // Find first { … last }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = cleaned.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as Partial<AgentConfigSuggestion>;
    if (!parsed.name || !parsed.persona) return null;
    const tone = ['friendly', 'formal', 'casual', 'concise'].includes(parsed.tone as string)
      ? (parsed.tone as AiTone)
      : 'friendly';
    const mode = ['single', 'multi', 'dynamic'].includes(parsed.response_mode as string)
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
      language: String(parsed.language || 'es'),
    };
  } catch {
    return null;
  }
}

function fallbackConfig(url: string): AgentConfigSuggestion {
  let host = 'la marca';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    /* keep default */
  }
  return {
    name: 'Asistente',
    persona: [
      `Sos la voz de ${host} en WhatsApp. Atendés clientes con calidez, vas al grano y nunca admitís ser un sistema automático.`,
      'Respondés en español neutro, sin em-dashes, sin hashtags, sin emojis decorativos. Una pregunta por turno.',
      'Si el cliente pregunta por un producto, primero confirmá cuál es y después pasás precio o stock. Si pregunta por envíos, pedí ciudad antes de cotizar.',
      'Si el cliente está molesto, querés un reembolso, mencionás "hablar con un humano" o el tema sale de tu alcance, escalá a un agente humano sin discutir.',
      'No inventes precios, promociones ni políticas que no estén en el contexto. Si no sabés algo, decilo y ofrecé pasarlo a un humano.',
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
      { status: 401 },
    );

  const body = (await request.json().catch(() => null)) as {
    url?: string;
    workspace_id?: string;
  } | null;
  const rawUrl = body?.url?.trim();
  const workspaceId = body?.workspace_id?.trim();
  if (!rawUrl || !workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.urlWorkspaceRequired') },
      { status: 400 },
    );
  }
  const parsed = isPublicHttpsUrl(rawUrl);
  if (!parsed) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.urlInvalidHttps') },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  const { data: member } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member)
    return NextResponse.json(
      { error: translate(locale, 'errAi.forbidden') },
      { status: 403 },
    );

  // 1) Scrape
  let knowledge = '';
  try {
    knowledge = await scrapeSite(parsed.toString(), locale);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : translate(locale, 'errAi.scrapeFailed'),
      },
      { status: 502 },
    );
  }

  // 2) Generate config with Claude (fallback if no knowledge or AI fails)
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  let config: AgentConfigSuggestion = fallbackConfig(parsed.toString());
  if (anthropicKey && knowledge.trim().length > 200) {
    try {
      const client = getAnthropic(anthropicKey);
      const completion = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: META_SYSTEM,
        messages: [
          { role: 'user', content: META_USER_TEMPLATE(knowledge, parsed.toString()) },
        ],
      });
      const text = completion.content
        .map((c) => ('type' in c && c.type === 'text' ? c.text : ''))
        .join('')
        .trim();
      const parsedCfg = safeParseConfig(text);
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
    is_active: true,
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
    model: 'claude-haiku-4-5-20251001',
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
    return serverError(error, translate(locale, 'errAi.agentCreateFailed'), 500);
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
    { status: 201 },
  );
}
