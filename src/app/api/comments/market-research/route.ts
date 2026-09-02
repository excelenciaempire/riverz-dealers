import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { selectAll } from '@/lib/db/paginate';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { resolveAnthropicKey } from '@/lib/ai/platform-key';
import { completeTextConUso, hasLlm } from '@/lib/ai/llm-client';
import { cobrarUsoDeIa } from '@/lib/wallet/cobrar-uso';
import {
  analyzeCommentMetrics,
  buildMarketResearchPrompt,
  buildEvidenceActions,
  COMMENT_CATEGORIES,
  filterCommentsByCategory,
  fallbackResearch,
  parseMarketResearchResponse,
  type CommentCategory,
  type CommentChannel,
  type ResearchComment,
} from '@/lib/comments/market-research';

const COMMENT_CHANNELS: CommentChannel[] = [
  'ig_comment',
  'fb_comment',
  'tiktok_comment',
];
/** El cálculo recorre todo; la síntesis usa una muestra transparente y acotada. */
const MAX_QUALITATIVE_SAMPLE = 200;

type ResearchProgressStage = 'reading' | 'calculating' | 'synthesizing';

type ResearchStreamEvent =
  | { type: 'progress'; stage: ResearchProgressStage; value: number }
  | {
      type: 'result';
      report: {
        total: number;
        analyzed_sample: number;
        generated_with_ai: boolean;
        metrics: ReturnType<typeof analyzeCommentMetrics>;
        summary: string;
        findings: Array<{ title: string; detail: string }>;
        opportunities: string[];
        risks: string[];
        actions: string[];
      };
    }
  | { type: 'error'; error: string };

type CommentRow = {
  id: string;
  channel: CommentChannel;
  content_text: string | null;
  created_at: string;
  sender_type: string | null;
};

function commentsFromRows(rows: readonly CommentRow[]): ResearchComment[] {
  return rows
    .filter((row) => row.sender_type === 'customer' && row.content_text?.trim())
    .map((row) => ({
      id: row.id,
      channel: row.channel,
      text: String(row.content_text).trim(),
      createdAt: row.created_at,
    }));
}

/** Lee la fuente completa una sola vez y mantiene el criterio de comentario igual en POST y GET. */
async function readWorkspaceComments(workspaceId: string): Promise<ResearchComment[]> {
  const admin = supabaseAdmin();
  const rows = await selectAll<CommentRow>(
    admin,
    'messages',
    (query) =>
      query
        .in('channel', COMMENT_CHANNELS)
        .eq('conversations.workspace_id', workspaceId),
    {
      select:
        'id,channel,content_text,created_at,sender_type,conversations!inner(workspace_id)',
      orderBy: 'created_at',
    }
  );
  return commentsFromRows(rows);
}

async function assertWorkspaceMember(workspaceId: string, userId: string) {
  const admin = supabaseAdmin();
  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(membership && ['owner', 'admin'].includes(String(membership.role)));
}

/**
 * GET /api/comments/market-research?workspace_id=…&category=price&page=0
 *
 * Devuelve comentarios reales que explican una métrica. El filtro vuelve a usar
 * exactamente la misma clasificación determinista del reporte; no hay conteos
 * decorativos ni una segunda regla oculta para el detalle.
 */
export async function GET(request: Request) {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, 'errInbox.unauthorized') },
      { status: 401 }
    );
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get('workspace_id')?.trim();
  const requested = url.searchParams.get('category') ?? 'all';
  const category = (COMMENT_CATEGORIES as readonly string[]).includes(requested)
    ? (requested as CommentCategory)
    : null;
  const page = Math.max(0, Number.parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
  const pageSize = 50;
  if (!workspaceId || !category)
    return NextResponse.json(
      { error: translate(locale, 'errAi.workspaceIdRequired') },
      { status: 400 }
    );
  if (!(await assertWorkspaceMember(workspaceId, user.id)))
    return NextResponse.json(
      { error: translate(locale, 'errAi.forbidden') },
      { status: 403 }
    );

  try {
    const matched = filterCommentsByCategory(
      await readWorkspaceComments(workspaceId),
      category
    ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const start = page * pageSize;
    return NextResponse.json({
      category,
      total: matched.length,
      page,
      page_size: pageSize,
      comments: matched.slice(start, start + pageSize),
      has_more: start + pageSize < matched.length,
    });
  } catch (error) {
    console.error('[comments/market-research] detail failed', { workspaceId, error });
    return NextResponse.json(
      { error: translate(locale, 'errAi.marketResearchFailed') },
      { status: 500 }
    );
  }
}

/**
 * POST /api/comments/market-research
 *
 * Research pasivo de la voz del mercado. No modifica comentarios, contactos,
 * reglas ni respuestas; sólo lee los comentarios entrantes del comercio.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.unauthorized') },
      { status: 401 }
    );
  }
  const body = (await request.json().catch(() => null)) as {
    workspace_id?: string;
  } | null;
  const workspaceId = body?.workspace_id?.trim();
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.workspaceIdRequired') },
      { status: 400 }
    );
  }

  if (!(await assertWorkspaceMember(workspaceId, user.id))) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.forbidden') },
      { status: 403 }
    );
  }
  const admin = supabaseAdmin();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ResearchStreamEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const progress = (stage: ResearchProgressStage, value: number) =>
        send({ type: 'progress', stage, value });

      try {
        progress('reading', 18);
        const comments = await readWorkspaceComments(workspaceId);
        if (comments.length === 0) {
          send({
            type: 'error',
            error: translate(locale, 'errAi.noCommentsForResearch'),
          });
          return;
        }

        progress('calculating', 55);
        const metrics = analyzeCommentMetrics(comments);
        const qualitative = representativeSample(comments, MAX_QUALITATIVE_SAMPLE);
        const language = locale === 'en' ? 'en' : 'es';
        let insight = fallbackResearch(metrics, language);
        let generatedWithAi = false;

        progress('synthesizing', 78);
        const clave = await resolveAnthropicKey(admin, { workspaceId });
        if (hasLlm(clave?.key)) {
          try {
            const completado = await completeTextConUso({
              tier: 'premium',
              system:
                'You produce evidence-based market research from customer comments. Never make up facts.',
              user: buildMarketResearchPrompt({
                locale: language,
                metrics,
                comments: qualitative,
              }),
              maxTokens: 1600,
              anthropicKey: clave?.key,
              effort: 'low',
            });
            // La síntesis se genera para este comercio: si usa la clave de
            // Riverz, su consumo queda en su saldo. Con una clave propia, el
            // proveedor ya le factura directamente y no se duplica el cobro.
            await cobrarUsoDeIa(admin, workspaceId, {
              concepto: 'investigacion',
              modelo: completado.modelo,
              uso: completado.uso,
              origenDeLaClave: clave?.source,
              referenciaTipo: 'analisis_comentarios',
              detalle: {
                proveedor: completado.proveedor,
                comentariosAnalizados: qualitative.length,
              },
            });
            const parsed = parseMarketResearchResponse(completado.text);
            if (parsed) {
              // Las conclusiones se pueden redactar con IA, pero los próximos
              // pasos siempre nacen de señales contadas sobre TODO el corpus.
              insight = {
                ...parsed,
                actions: buildEvidenceActions(metrics, language),
              };
              generatedWithAi = true;
            }
          } catch (error) {
            console.error('[comments/market-research] AI synthesis failed', {
              workspaceId,
              error,
            });
          }
        }

        send({
          type: 'result',
          report: {
            total: comments.length,
            analyzed_sample: qualitative.length,
            metrics,
            ...insight,
            generated_with_ai: generatedWithAi,
          },
        });
      } catch (error) {
        console.error('[comments/market-research] failed', {
          workspaceId,
          error,
        });
        send({
          type: 'error',
          error: translate(locale, 'errAi.marketResearchFailed'),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}

/** Conserva señales de cada red y recencia sin hacer pasar la muestra por todo el corpus. */
function representativeSample(
  comments: readonly ResearchComment[],
  max: number
): ResearchComment[] {
  if (comments.length <= max) return [...comments];
  const byChannel = new Map<CommentChannel, ResearchComment[]>();
  for (const comment of comments) {
    const list = byChannel.get(comment.channel) ?? [];
    list.push(comment);
    byChannel.set(comment.channel, list);
  }
  const out: ResearchComment[] = [];
  for (const channel of COMMENT_CHANNELS) {
    const list = byChannel.get(channel) ?? [];
    const target = Math.max(
      1,
      Math.round((list.length / comments.length) * max)
    );
    const step = Math.max(1, Math.floor(list.length / target));
    for (let index = 0; index < list.length && out.length < max; index += step)
      out.push(list[index]);
  }
  return out.slice(0, max);
}
