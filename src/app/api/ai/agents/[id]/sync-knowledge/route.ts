import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import type { AiAgent } from '@/lib/ai/types';

/**
 * POST /api/ai/agents/[id]/sync-knowledge
 *   body: { url: string }
 *
 * Crawl up to 30 páginas del sitio del cliente usando Firecrawl,
 * aglomera el markdown en un blob (capeado a 30k chars) y lo guarda
 * en `ai_agents.knowledge`. También persiste la URL y el timestamp
 * para que el editor pueda mostrar "última sincronización" sin un
 * fetch adicional.
 *
 * Firecrawl es async: arrancamos un crawl con POST /v1/crawl, luego
 * polleamos /v1/crawl/{id} cada 5s hasta `completed` o timeout
 * (60s). Si el crawl no termina a tiempo, devolvemos un 202 con la
 * cuenta parcial para que la UI no se quede colgada.
 */

const FIRECRAWL_BASE = 'https://api.firecrawl.dev';
const KNOWLEDGE_CHAR_CAP = 30_000;
const CRAWL_PAGE_LIMIT = 30;
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 60_000;

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

async function requireMember(agentId: string, userId: string) {
  const admin = supabaseAdmin();
  const { data: agent } = await admin
    .from('ai_agents')
    .select('id, workspace_id')
    .eq('id', agentId)
    .maybeSingle();
  if (!agent) return null;
  const { data: member } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', (agent as { workspace_id: string }).workspace_id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!member) return null;
  return agent as { id: string; workspace_id: string };
}

function isValidHttpsUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u;
  } catch {
    return null;
  }
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
      // Acepta lo que entre en lo que queda.
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const target = await requireMember(id, user.id);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { url?: string } | null;
  const rawUrl = body?.url?.trim();
  if (!rawUrl) {
    return NextResponse.json({ error: 'url required' }, { status: 400 });
  }
  const parsed = isValidHttpsUrl(rawUrl);
  if (!parsed) {
    return NextResponse.json(
      { error: 'URL inválida. Debe empezar con https://' },
      { status: 400 },
    );
  }

  const apiKey = process.env.FIRECRAWL_API_KEY || 'fc-33dd0d0bd6b4430c9f36d0555660ddae';
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Falta FIRECRAWL_API_KEY en el servidor.' },
      { status: 500 },
    );
  }

  // 1) Disparar el crawl.
  let startJson: FirecrawlCrawlStart;
  try {
    const startRes = await fetch(`${FIRECRAWL_BASE}/v1/crawl`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: parsed.toString(),
        limit: CRAWL_PAGE_LIMIT,
        scrapeOptions: {
          formats: ['markdown'],
          onlyMainContent: true,
        },
      }),
    });
    startJson = (await startRes.json().catch(() => ({}))) as FirecrawlCrawlStart;
    if (!startRes.ok || !startJson?.id) {
      return NextResponse.json(
        {
          error:
            startJson?.error ?? `Firecrawl no aceptó el crawl (status ${startRes.status})`,
        },
        { status: 502 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'No se pudo contactar Firecrawl' },
      { status: 502 },
    );
  }

  const crawlId = startJson.id;

  // 2) Pollear hasta `completed` o timeout.
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
        return NextResponse.json(
          { error: json.error ?? 'Firecrawl falló durante el crawl.' },
          { status: 502 },
        );
      }
    } catch {
      // Ignorar errores transitorios y seguir polleando hasta el deadline.
    }
  }

  const pages = (lastStatus?.data ?? []) as FirecrawlCrawlPage[];
  const knowledge = aggregateMarkdown(pages);
  const syncedAt = new Date().toISOString();
  const finished = lastStatus?.status === 'completed';

  // 3) Persistir aunque haya quedado parcial: el cliente lo nota por
  //    `pages_scraped` y puede volver a sincronizar.
  const admin = supabaseAdmin();
  const { error: updateError } = await admin
    .from('ai_agents')
    .update({
      knowledge: knowledge || null,
      knowledge_url: parsed.toString(),
      knowledge_synced_at: syncedAt,
    })
    .eq('id', id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { data: fresh } = await admin
    .from('ai_agents')
    .select('*, ai_agent_channels(channel), ai_agent_products(product_id)')
    .eq('id', id)
    .maybeSingle();
  const safe = fresh
    ? (() => {
        const { api_key_encrypted, ...rest } = fresh as AiAgent;
        return { ...rest, has_api_key: Boolean(api_key_encrypted) };
      })()
    : null;

  return NextResponse.json(
    {
      ok: true,
      finished,
      pages_scraped: pages.length,
      knowledge_chars: knowledge.length,
      knowledge_synced_at: syncedAt,
      agent: safe,
    },
    { status: finished ? 200 : 202 },
  );
}
