import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'
import {
  getConnectionForUser,
  getConnectionForWorkspace,
} from '@/lib/shopify/connection'
import { shopifyRedirectUri, shopifyScopes } from '@/lib/shopify/oauth'
import { tiendaEsperandoInstalacion } from '@/lib/shopify/apps-del-comercio'
import { conectarPendientes } from '@/lib/shopify/conectar-con-credenciales'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'

/** Último reintento de la tienda en espera, por workspace: la tarjeta pregunta
 *  seguido y cada intento es una llamada a Shopify. */
const ultimoIntento = new Map<string, number>()
const ESPERA_MS = 20_000

/**
 * Settings card connection state. Post-055 we prefer workspace_id (so a
 * second member of the same workspace sees the connection too), and
 * fall back to the legacy user_id read for users with no workspace yet.
 *
 * `oauth`: whether the public app can be installed on any store. Shopify
 * only allows that once the App Store approves it, so it stays off until
 * `SHOPIFY_APP_STORE_APPROVED=true`. `config`: what a merchant's own app
 * must be created with, in the Dev Dashboard. `pendiente`: the store whose
 * saved app hasn't been installed yet; while there is one, each read retries
 * it, so the card flips to connected as soon as the owner installs.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  let conn = workspaceId
    ? await getConnectionForWorkspace(supabase, workspaceId)
    : await getConnectionForUser(supabase, user.id)
  const oauth =
    Boolean(process.env.SHOPIFY_API_KEY) &&
    process.env.SHOPIFY_APP_STORE_APPROVED === 'true'
  const appUrl = process.env.NEXT_PUBLIC_SITE_URL ?? null
  const config = appUrl
    ? { appUrl, redirectUrl: shopifyRedirectUri(), scopes: shopifyScopes() }
    : null
  let pendiente =
    workspaceId && conn?.status !== 'active'
      ? await tiendaEsperandoInstalacion(supabaseAdmin(), workspaceId).catch(
          () => null,
        )
      : null
  if (
    pendiente &&
    workspaceId &&
    Date.now() - (ultimoIntento.get(workspaceId) ?? 0) > ESPERA_MS
  ) {
    ultimoIntento.set(workspaceId, Date.now())
    const conectadas = await conectarPendientes(supabaseAdmin(), {
      workspaceId,
      callbackBase: appUrl ?? new URL(request.url).origin,
    }).catch(() => 0)
    if (conectadas > 0) {
      conn = await getConnectionForWorkspace(supabase, workspaceId)
      pendiente = null
    }
  }
  return NextResponse.json({ oauth, config, pendiente, connection: conn })
}

/** Disconnect (delete) the workspace's Shopify connection. */
export async function DELETE(req: Request) {
  const block = await csrfGuard(req)
  if (block) return block
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Scope the delete to the workspace, not the installer's user_id —
  // any workspace member should be able to disconnect.
  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  if (workspaceId) {
    const { error } = await supabase
      .from('shopify_connections')
      .delete()
      .eq('platform', 'shopify')
      .eq('workspace_id', workspaceId)
    if (error) return serverError(error)
    // Its saved app too: otherwise opening it from Shopify reconnects the store.
    const { error: appsError } = await supabaseAdmin()
      .from('shopify_custom_apps')
      .delete()
      .eq('workspace_id', workspaceId)
    if (appsError) return serverError(appsError)
  } else {
    // Legacy fallback for users without a workspace row.
    const { error } = await supabase
      .from('shopify_connections')
      .delete()
      .eq('platform', 'shopify')
      .eq('user_id', user.id)
    if (error) return serverError(error)
  }
  return NextResponse.json({ ok: true })
}
