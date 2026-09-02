import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { selectAll } from '@/lib/db/paginate';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { resolveAnthropicKey } from '@/lib/ai/platform-key';
import { completeText, hasLlm } from '@/lib/ai/llm-client';
import {
  analyzeCommentMetrics,
  buildMarketResearchPrompt,
  fallbackResearch,
  parseMarketResearchResponse,
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

  const admin = supabaseAdmin();
  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership || !['owner', 'admin'].includes(String(membership.role))) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.forbidden') },
      { status: 403 }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ResearchStreamEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const progress = (stage: ResearchProgressStage, value: number) =>
        send({ type: 'progress', stage, value });

      try {
        progress('reading', 18);
        const rows = await selectAll<{
          channel: CommentChannel;
          content_text: string | null;
          created_at: string;
          sender_type: string | null;
        }>(
          admin,
          'messages',
          (query) =>
            query
              .in('channel', COMMENT_CHANNELS)
              .eq('conversations.workspace_id', workspaceId),
          {
            select:
              'channel,content_text,created_at,sender_type,conversations!inner(workspace_id)',
            orderBy: 'created_at',
          }
        );
        const comments: ResearchComment[] = rows
          .filter(
            (row) => row.sender_type === 'customer' && row.content_text?.trim()
          )
          .map((row) => ({
            channel: row.channel,
            text: String(row.content_text).trim(),
            createdAt: row.created_at,
          }));
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
        const key =
          (await resolveAnthropicKey(admin, { workspaceId }))?.key ?? null;
        if (hasLlm(key)) {
          try {
            const text = await completeText({
              tier: 'premium',
              system:
                'You produce evidence-based market research from customer comments. Never make up facts.',
              user: buildMarketResearchPrompt({
                locale: language,
                metrics,
                comments: qualitative,
              }),
              maxTokens: 1600,
              anthropicKey: key,
              effort: 'low',
            });
            const parsed = parseMarketResearchResponse(text);
            if (parsed) {
              insight = parsed;
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
