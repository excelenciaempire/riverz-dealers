import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { listConnections } from '@/lib/channels/connections';
import { pullCommentsForWorkspace } from '@/lib/channels/comment-pull';
import {
  isAdSyncFailure,
  syncAdPostsForConnection,
} from '@/lib/channels/meta-ads-sync';
import { backfillTikTokCommentsForWorkspace } from '@/lib/channels/tiktok_comment/poll';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

const COMMENT_CHANNELS = [
  'ig_comment',
  'fb_comment',
  'tiktok_comment',
] as const;
type CommentChannel = (typeof COMMENT_CHANNELS)[number];

/**
 * POST /api/comments/backfill
 *
 * Recuperación manual, acotada y pasiva de comentarios de Meta. Aunque el
 * comentario sea reciente, `suppressAutoReply` evita expresamente que esta
 * importación dispare una respuesta, una regla o la IA.
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
    days?: number;
    channels?: string[];
    date_from?: string;
    date_to?: string;
    all_history?: boolean;
  } | null;
  const workspaceId = body?.workspace_id?.trim();
  const days = Number(body?.days);
  const fromMs = dateBoundary(body?.date_from, false);
  const untilMs = dateBoundary(body?.date_to, true);
  const allHistory = body?.all_history === true;
  const channels = (body?.channels ?? []).filter(
    (channel): channel is CommentChannel =>
      (COMMENT_CHANNELS as readonly string[]).includes(channel)
  );

  const validDays = Number.isInteger(days) && days >= 1 && days <= 3650;
  if (
    !workspaceId ||
    !channels.length ||
    (!allHistory && !validDays && fromMs === undefined) ||
    fromMs === null ||
    untilMs === null ||
    (fromMs !== undefined && untilMs !== undefined && fromMs > untilMs)
  ) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.backfillInvalid') },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();
  const startMs = allHistory
    ? 0
    : (fromMs ?? Date.now() - days * 24 * 60 * 60 * 1000);
  const endMs = untilMs ?? Date.now();
  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership || !['owner', 'admin'].includes(String(membership.role))) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.forbiddenAdminOnly') },
      { status: 403 }
    );
  }

  // Antes de leer comentarios, descubrimos las creatividades publicitarias.
  // Meta no lista los dark posts en el feed normal y sin este paso el botón
  // daría la falsa impresión de haber revisado una cuenta que pauta.
  const connections = await listConnections(admin, {
    workspaceId,
    channels,
    statuses: ['connected'],
  });
  const metaChannels = channels.filter(
    (channel): channel is 'ig_comment' | 'fb_comment' =>
      channel !== 'tiktok_comment'
  );
  // Instagram también: sus anuncios se mapean por `effective_instagram_media_id`
  // con las cuentas publicitarias elegidas para la página.
  const adDiscovery = await Promise.all(
    connections
      .filter(
        (connection) =>
          connection.channel === 'fb_comment' ||
          connection.channel === 'ig_comment'
      )
      .map(async (connection) => {
        try {
          return {
            connection_id: connection.id,
            ...(await syncAdPostsForConnection(admin, connection, {
              maxPages: Number.MAX_SAFE_INTEGER,
            })),
          };
        } catch (error) {
          console.error('[comments/backfill] ad discovery failed', {
            connectionId: connection.id,
            error,
          });
          return {
            connection_id: connection.id,
            inserted: 0,
            updated: 0,
            discoveredPosts: 0,
            scannedAccounts: 0,
            status: 'failed' as const,
            errors: ['ad_discovery_failed'],
          };
        }
      })
  );

  const result =
    metaChannels.length > 0
      ? await pullCommentsForWorkspace(admin, workspaceId, {
          windowMs: Date.now() - startMs,
          untilMs: endMs,
          maxPosts: Number.MAX_SAFE_INTEGER,
          maxCommentPages: Number.MAX_SAFE_INTEGER,
          // La ventana limita comentarios, no publicaciones: una campaña o un
          // post antiguo puede recibir actividad hoy. Se conserva para todos
          // los comercios, incluso cuando el usuario elige sólo 7/30/90 días.
          includeOlderPosts: true,
          suppressAutoReply: true,
          channels: metaChannels,
        })
      : {
          connections: 0,
          ingestedInbound: 0,
          ingested: 0,
          seen: 0,
          detail: [],
        };
  const tiktok = channels.includes('tiktok_comment')
    ? await backfillTikTokCommentsForWorkspace(workspaceId, {
        sinceMs: startMs,
        untilMs: endMs,
      })
    : null;
  const pullIncomplete = result.detail.some(
    (item) => item.reason === 'graph_denegado' || item.reason === 'partial'
  );
  // Sin cuenta publicitaria elegida no hay nada que descubrir, y no es una
  // importación a medias: queda anotado en `ad_discovery` (`ad_account_missing`).
  const adIncomplete = adDiscovery.some((item) => isAdSyncFailure(item));
  const tiktokIncomplete = tiktok?.detail.some((item) => item.error) ?? false;
  const complete = !pullIncomplete && !adIncomplete && !tiktokIncomplete;
  return NextResponse.json({
    ok: complete,
    complete,
    partial: !complete,
    date_from: startMs ? new Date(startMs).toISOString() : null,
    date_to: new Date(endMs).toISOString(),
    ad_discovery: adDiscovery,
    tiktok,
    ...result,
  });
}

/** Fecha civil elegida en la UI, interpretada completa en UTC. */
function dateBoundary(
  value: string | undefined,
  end: boolean
): number | undefined | null {
  if (value === undefined || value === '') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}
