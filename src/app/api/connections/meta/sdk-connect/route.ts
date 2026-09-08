import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import {
  persistMetaConnections,
  MetaConnectError,
} from '@/lib/channels/meta-connect';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import type { Channel } from '@/types';

// v25.0 para que coincida con la versión del SDK que emitió el code
// (FB.login usa v25.0); un code debe canjearse en la misma versión o superior.
const GRAPH = 'https://graph.facebook.com/v25.0';
// Only the DM channels are connectable. persistMetaConnections() auto-creates
// the comment SIBLING (messenger→fb_comment, instagram→ig_comment), so a
// comment channel is never connected standalone — accepting it here would
// create a comment row with no DM row (its DMs would then be dropped).
const VALID_CHANNELS = ['messenger', 'instagram'];

/**
 * POST /api/connections/meta/sdk-connect
 *
 * Completes Facebook Login for Business for Messenger / Instagram via the
 * JS SDK (FB.login with our config_id). The client gets an authorization
 * `code` from FB.login and posts it here; we exchange it for a long-lived
 * user token (FL4B codes are exchanged WITHOUT a redirect_uri), then
 * discover + persist the page / IG connections via the shared helper.
 *
 * Replaces the server-side redirect flow for Meta channels: Facebook
 * rejects config_id on the bare dialog/oauth redirect ("config_id is
 * required"), but accepts it through FB.login — same as WhatsApp ES.
 *
 * Body: { code, channel, workspace_id }
 */
export async function POST(req: Request): Promise<Response> {
  const block = await csrfGuard(req);
  if (block) return block;

  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, 'errInbox.notSignedIn') },
      { status: 401 }
    );

  const body = (await req.json().catch(() => null)) as {
    code?: string;
    access_token?: string;
    channel?: string;
    workspace_id?: string;
    list_only?: boolean;
    page_ids?: string[];
    ad_account_ids_by_page?: Record<string, string[]>;
    include_instagram?: boolean;
    instagram_account_ids?: string[];
  } | null;
  if (
    !body ||
    !body.channel ||
    !body.workspace_id ||
    !(body.code || body.access_token)
  ) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.sdkConnectMissingFields') },
      { status: 400 }
    );
  }
  if (!VALID_CHANNELS.includes(body.channel)) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.invalidChannel') },
      { status: 400 }
    );
  }
  if (
    !body.list_only &&
    (!Array.isArray(body.page_ids) ||
      body.page_ids.every((id) => typeof id !== 'string' || !id.trim()))
  ) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.metaAssetSelectionRequired') },
      { status: 400 }
    );
  }
  if (
    !body.list_only &&
    body.channel === 'messenger' &&
    body.ad_account_ids_by_page !== undefined
  ) {
    const selected = normalizeAdAccountIdsByPage(body.ad_account_ids_by_page);
    const pages = (body.page_ids ?? []).filter(
      (id): id is string => typeof id === 'string' && Boolean(id.trim())
    );
    if (pages.some((pageId) => (selected[pageId]?.length ?? 0) === 0)) {
      return NextResponse.json(
        { error: translate(locale, 'errInbox.metaAdAccountSelectionRequired') },
        { status: 400 }
      );
    }
  }

  const admin = supabaseAdmin();
  const { data: membership } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', body.workspace_id)
    .eq('user_id', user.id)
    .eq('role', 'admin')
    .maybeSingle();
  if (!membership)
    return NextResponse.json(
      { error: translate(locale, 'errInbox.forbidden') },
      { status: 403 }
    );

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: translate(locale, 'errInbox.metaAppNotConfigured') },
      { status: 503 }
    );
  }

  try {
    // 1. Conseguir el user token.
    //    Config de identificador de USUARIO: FB.login ya devuelve el
    //    accessToken en el cliente, así que lo recibimos directo y nos
    //    saltamos el code-exchange (que daba 400 error_subcode 36008 porque
    //    el code del SDK exige cuadrar el redirect_uri interno del
    //    xd_arbiter, imposible de reconstruir en el server).
    //    Fallback: si en cambio llega un `code` (configs que devuelven
    //    code), lo canjeamos con redirect_uri vacío y exponemos el error
    //    real de Facebook si falla.
    let accessToken: string | undefined = body.access_token;
    if (!accessToken && body.code) {
      const tokRes = await fetch(
        `${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=&code=${encodeURIComponent(body.code)}`
      );
      if (!tokRes.ok) {
        const detail = await tokRes.text().catch(() => '');
        console.error(
          '[meta/sdk-connect] token exchange failed:',
          tokRes.status,
          detail
        );
        throw new MetaConnectError(
          `token exchange failed (${tokRes.status}): ${detail.slice(0, 400)}`
        );
      }
      const tok = (await tokRes.json()) as { access_token?: string };
      accessToken = tok.access_token;
    }
    if (!accessToken) throw new MetaConnectError('no access_token');

    // 2. Swap for a long-lived token (~60d) so the derived page tokens
    //    don't expire. Non-fatal.
    try {
      const ll = await fetch(
        `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(accessToken)}`
      );
      if (ll.ok) {
        const j = (await ll.json()) as { access_token?: string };
        if (j.access_token) accessToken = j.access_token;
      }
    } catch (err) {
      console.warn(
        '[meta/sdk-connect] fb_exchange_token failed (non-fatal):',
        err
      );
    }

    // 3a. list_only: just discover the manageable pages / IG accounts so the
    //     client can show a picker, WITHOUT persisting anything.
    if (body.list_only) {
      const { discoverMetaAccounts, listUserAdAccounts } =
        await import('@/lib/channels/meta-graph');
      const discovered = await discoverMetaAccounts(
        accessToken,
        body.channel as Channel
      );
      const instagramAccounts =
        body.channel === 'messenger'
          ? await discoverMetaAccounts(accessToken, 'instagram')
          : [];
      let adAccounts: Array<{ id: string; label: string }> = [];
      if (body.channel === 'messenger') {
        try {
          adAccounts = await listUserAdAccounts(accessToken);
        } catch (error) {
          // Ad accounts are optional. Missing marketing permissions must not
          // prevent the user from connecting the Pages they selected.
          console.warn(
            '[meta/sdk-connect] ad account discovery skipped:',
            error
          );
        }
      }
      return NextResponse.json({
        accounts: discovered.map((a) => ({
          id: a.external_account_id,
          label: a.label,
        })),
        instagramAccounts: instagramAccounts.map((a) => ({
          id: a.external_account_id,
          label: a.label,
          pageId: String(a.config.page_id ?? ''),
        })),
        adAccounts,
      });
    }

    // 3b. Persist only the accounts explicitly selected in the picker. Meta
    //     can return several brands for one Facebook profile; none may bleed
    //     into this workspace merely because the profile can manage them.
    const pageIds = body.page_ids!.filter(
      (id): id is string => typeof id === 'string' && Boolean(id.trim())
    );
    const result = await persistMetaConnections(admin, {
      accessToken,
      channel: body.channel as Channel,
      workspaceId: body.workspace_id,
      userId: user.id,
      pageIds,
      adAccountIdsByPage: normalizeAdAccountIdsByPage(
        body.ad_account_ids_by_page
      ),
    });

    // One Riverz Meta connection starts from a Facebook Page. When that Page
    // has a linked Instagram professional account, set up its IG DMs and
    // comments in the same consent flow instead of making the merchant repeat
    // the whole authorization on a second card.
    if (body.channel === 'messenger' && body.include_instagram) {
      const { discoverMetaAccounts } =
        await import('@/lib/channels/meta-graph');
      const instagramAccounts = await discoverMetaAccounts(
        accessToken,
        'instagram'
      );
      const requestedInstagramIds = body.instagram_account_ids
        ? new Set(body.instagram_account_ids.map(String))
        : null;
      const selectedInstagramIds = instagramAccounts
        .filter(
          (account) =>
            pageIds.includes(String(account.config.page_id)) &&
            (!requestedInstagramIds ||
              requestedInstagramIds.has(account.external_account_id))
        )
        .map((account) => account.external_account_id);
      if (selectedInstagramIds.length > 0) {
        const instagram = await persistMetaConnections(admin, {
          accessToken,
          channel: 'instagram',
          workspaceId: body.workspace_id,
          userId: user.id,
          pageIds: selectedInstagramIds,
        });
        return NextResponse.json({
          ok: true,
          saved: result.saved + instagram.saved,
          subscribed: result.subscribed + instagram.subscribed,
        });
      }
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg =
      err instanceof MetaConnectError &&
      err.message === 'meta_asset_selection_required'
        ? translate(locale, 'errInbox.metaAssetSelectionRequired')
        : err instanceof MetaConnectError &&
            err.message === 'meta_selected_asset_unavailable'
          ? translate(locale, 'errInbox.metaSelectedAssetUnavailable')
          : err instanceof MetaConnectError
            ? err.message
            : translate(locale, 'errInbox.metaConnectionFailed');
    console.error('[meta/sdk-connect] error:', err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

function normalizeAdAccountIdsByPage(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([pageId, ids]) => [
      pageId,
      Array.from(
        new Set(
          (Array.isArray(ids) ? ids : [])
            .map(String)
            .filter((id) => /^act_\d+$/.test(id))
        )
      ),
    ])
  );
}
