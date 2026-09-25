import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { normalizeShopDomain } from '@/lib/shopify/oauth';
import { registrarAppDelComercio } from '@/lib/shopify/apps-del-comercio';
import { conectarConCredenciales } from '@/lib/shopify/conectar-con-credenciales';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { getLogger } from '@/lib/log/logger';

const log = getLogger('shopify.connect-client-credentials');

/**
 * Connect a store with the Client ID + Client secret of a Shopify app.
 *
 * Two kinds of app land here:
 *  - The merchant's own app, in the store's organization: the client
 *    credentials grant works once it's installed, and we connect right away.
 *  - An app Riverz created for this store with custom distribution, or the
 *    merchant's own app before installing it: Shopify answers
 *    `app_not_installed`. We save the credentials and the store connects by
 *    itself when the owner installs it (OAuth start/callback, migration 275).
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { shop?: string; clientId?: string; clientSecret?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const shop = normalizeShopDomain(body.shop ?? '');
  const clientId = (body.clientId ?? '').trim();
  const clientSecret = (body.clientSecret ?? '').trim();
  if (!shop) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.invalidShopDomain') },
      { status: 400 }
    );
  }
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error: translate(locale, 'errProducts.shopifyMissingCredentialFields'),
      },
      { status: 400 }
    );
  }
  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id);
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.noWorkspaceForUser') },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();
  const r = await conectarConCredenciales(admin, {
    userId: user.id,
    workspaceId,
    shop,
    clientId,
    clientSecret,
    callbackBase:
      process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin,
    locale,
  });
  if (!r.ok) {
    log.warn('connect_failed', { shop, motivo: r.motivo, error: r.error });
    if (r.motivo === 'no_instalada') {
      try {
        await registrarAppDelComercio(admin, {
          workspaceId,
          userId: user.id,
          shopDomain: shop,
          clientId,
          clientSecret,
        });
      } catch (regErr) {
        log.error('custom_app_register_failed', {
          shop,
          error: regErr instanceof Error ? regErr.message : String(regErr),
        });
        return NextResponse.json(
          { error: translate(locale, 'errProducts.shopifyConnectFailed') },
          { status: 500 }
        );
      }
      log.info('custom_app_registered', { shop, workspaceId });
      return NextResponse.json({
        ok: true,
        pendiente: true,
        shop_domain: shop,
      });
    }
    return NextResponse.json(
      {
        error: translate(
          locale,
          r.motivo === 'guardar'
            ? 'errProducts.shopifyConnectFailed'
            : 'errProducts.shopifyCredentialsInvalid'
        ),
      },
      { status: r.motivo === 'guardar' ? 500 : 400 }
    );
  }

  log.info('connect_client_credentials_success', {
    shop,
    userId: user.id,
    workspaceId,
  });
  return NextResponse.json({
    ok: true,
    shop_domain: shop,
    shop_name: r.shopName,
  });
}
