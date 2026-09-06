import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { ShopifyAdminClient } from './admin-client'
import { shopifyApiVersion } from './oauth'

export const WEBCHAT_EXTENSION_HANDLE = 'riverz-webchat'

export interface ThemeExtensionSetup {
  shopDomain: string
  clientId: string
  activationUrl: string
}

export type ThemeExtensionSetupError =
  | 'sin_tienda'
  | 'requiere_reconexion'
  | 'rechazo'

interface ShopifyGraphqlResponse<T> {
  data?: T
  errors?: Array<{ message?: string }>
}

/** URL oficial de Shopify para preactivar un app embed en el tema publicado. */
export function themeExtensionActivationUrl(args: {
  shopDomain: string
  clientId: string
  template?: 'product' | 'collection' | 'article' | 'blog'
}): string {
  const url = new URL(`https://${args.shopDomain}/admin/themes/current/editor`)
  url.searchParams.set('context', 'apps')
  if (args.template) url.searchParams.set('template', args.template)
  url.searchParams.set(
    'activateAppId',
    `${args.clientId}/${WEBCHAT_EXTENSION_HANDLE}`,
  )
  return url.toString()
}

/**
 * Guarda la llave pública del widget en la instalación de esta app.
 * Liquid la lee mediante `app.metafields.riverz.widget_key`, sin pedirle al
 * comercio que copie secretos ni que edite el tema.
 */
export async function syncWebchatAppMetafield(args: {
  shopDomain: string
  accessToken: string
  widgetKey: string
}): Promise<void> {
  const endpoint = `https://${args.shopDomain}/admin/api/${shopifyApiVersion()}/graphql.json`
  const installation = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': args.accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: 'query RiverzCurrentAppInstallation { currentAppInstallation { id } }',
    }),
  })
  if (!installation.ok) {
    throw new Error(`Shopify app installation ${installation.status}`)
  }
  const installationJson =
    (await installation.json()) as ShopifyGraphqlResponse<{
      currentAppInstallation?: { id?: string }
    }>
  const ownerId = installationJson.data?.currentAppInstallation?.id
  if (!ownerId || installationJson.errors?.length) {
    throw new Error(
      installationJson.errors?.[0]?.message || 'Shopify did not return the app installation',
    )
  }

  const written = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': args.accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query:
        'mutation RiverzSetWidgetKey($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id key value } userErrors { field message } } }',
      variables: {
        metafields: [
          {
            ownerId,
            namespace: 'riverz',
            key: 'widget_key',
            type: 'single_line_text_field',
            value: args.widgetKey,
          },
        ],
      },
    }),
  })
  if (!written.ok) throw new Error(`Shopify metafieldsSet ${written.status}`)
  const writtenJson =
    (await written.json()) as ShopifyGraphqlResponse<{
      metafieldsSet?: { userErrors?: Array<{ message?: string }> }
    }>
  const error = writtenJson.errors?.[0]?.message ||
    writtenJson.data?.metafieldsSet?.userErrors?.[0]?.message
  if (error) throw new Error(error)
}

/** Datos necesarios para preparar/activar el embed desde el panel de Riverz. */
export async function getThemeExtensionSetup(
  db: SupabaseClient,
  workspaceId: string,
): Promise<
  | { ok: true; setup: ThemeExtensionSetup; accessToken: string }
  | { ok: false; error: ThemeExtensionSetupError }
> {
  const { data } = await db
    .from('shopify_connections')
    .select('shop_domain, access_token, client_id_encrypted')
    .eq('workspace_id', workspaceId)
    .eq('platform', 'shopify')
    .eq('status', 'active')
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const row = data as {
    shop_domain?: string
    access_token?: string
    client_id_encrypted?: string | null
  } | null
  if (!row?.shop_domain || !row.access_token) return { ok: false, error: 'sin_tienda' }
  if (!row.client_id_encrypted) {
    return { ok: false, error: 'requiere_reconexion' }
  }
  try {
    const clientId = decrypt(row.client_id_encrypted)
    const accessToken = decrypt(row.access_token)
    return {
      ok: true,
      accessToken,
      setup: {
        shopDomain: row.shop_domain,
        clientId,
        activationUrl: themeExtensionActivationUrl({
          shopDomain: row.shop_domain,
          clientId,
          template: 'product',
        }),
      },
    }
  } catch {
    return { ok: false, error: 'requiere_reconexion' }
  }
}
/** Prepara el metafield y retira cualquier ScriptTag de Riverz anterior. */
export async function prepareThemeExtension(
  db: SupabaseClient,
  workspaceId: string,
  key: string,
): Promise<
  | { ok: true; setup: ThemeExtensionSetup }
  | { ok: false; error: ThemeExtensionSetupError; message?: string }
> {
  const resolved = await getThemeExtensionSetup(db, workspaceId)
  if (!resolved.ok) return resolved
  try {
    await syncWebchatAppMetafield({
      shopDomain: resolved.setup.shopDomain,
      accessToken: resolved.accessToken,
      widgetKey: key,
    })

    // Compatibilidad de transición: si esta instalación legacy tenía el
    // ScriptTag anterior, se retira antes de activar el embed para que nunca
    // existan dos widgets. La app pública no solicita estos scopes.
    const client = new ShopifyAdminClient(
      resolved.setup.shopDomain,
      resolved.accessToken,
      shopifyApiVersion(),
    )
    try {
      const existing = await client.rest<{
        script_tags?: Array<{ id?: number; src?: string }>
      }>('/script_tags.json?limit=250')
      for (const tag of existing.script_tags ?? []) {
        if (tag.id && (tag.src ?? '').includes('/widget/v1.js')) {
          await client.rest(`/script_tags/${tag.id}.json`, { method: 'DELETE' })
        }
      }
    } catch {
      // Una app pública sin scopes de ScriptTag llega aquí legítimamente.
    }
    return { ok: true, setup: resolved.setup }
  } catch (error) {
    return {
      ok: false,
      error: 'rechazo',
      message: error instanceof Error ? error.message.slice(0, 200) : undefined,
    }
  }
}
