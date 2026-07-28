import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { buildPluginZip, pluginHeaders } from '@/lib/commerce/plugin-package'
import { getStoreForWorkspace, getStoreWebhookSecret } from '@/lib/commerce/connection'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('woocommerce.plugin')

/**
 * Descarga del plugin para el comercio, ya configurado.
 *
 * El zip sale con la dirección de este servidor y el secreto de ESTA
 * tienda dentro, así que se instala y funciona: no hay que copiar
 * credenciales entre dos paneles, que es donde se pierde la mitad de la
 * gente.
 *
 * Por eso exige sesión y resuelve el workspace desde ella. El archivo
 * lleva un secreto adentro: servirlo sin autenticar sería publicar la
 * credencial de la tienda.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  if (!workspaceId) {
    return NextResponse.json({ error: 'no workspace' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const store = await getStoreForWorkspace(admin, 'woocommerce', workspaceId)
  if (!store || store.status !== 'active') {
    return NextResponse.json({ error: 'not_connected' }, { status: 400 })
  }

  const secret = await getStoreWebhookSecret(admin, 'woocommerce', store.shopDomain)
  if (!secret) {
    return NextResponse.json({ error: 'no_secret' }, { status: 500 })
  }

  try {
    const endpoint = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
    const zip = await buildPluginZip({ endpoint, secret })
    return new NextResponse(new Uint8Array(zip), {
      headers: pluginHeaders(zip.length, true),
    })
  } catch (err) {
    log.captureException(err, { workspaceId })
    return NextResponse.json({ error: 'build_failed' }, { status: 500 })
  }
}
