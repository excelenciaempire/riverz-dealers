import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  syncWebchatAppMetafield,
  themeExtensionActivationUrl,
  WEBCHAT_EXTENSION_HANDLE,
} from './theme-extension'
import { shopifyScopes } from './oauth'

describe('themeExtensionActivationUrl', () => {
  it('crea el deep link oficial sin aceptar otra ruta', () => {
    const url = new URL(
      themeExtensionActivationUrl({
        shopDomain: 'pilar-test.myshopify.com',
        clientId: 'client_123',
        template: 'product',
      }),
    )
    expect(url.origin).toBe('https://pilar-test.myshopify.com')
    expect(url.pathname).toBe('/admin/themes/current/editor')
    expect(url.searchParams.get('context')).toBe('apps')
    expect(url.searchParams.get('template')).toBe('product')
    expect(url.searchParams.get('activateAppId')).toBe(
      `client_123/${WEBCHAT_EXTENSION_HANDLE}`,
    )
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('syncWebchatAppMetafield', () => {
  it('resuelve la instalación y hace un único upsert de la llave', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { currentAppInstallation: { id: 'gid://shopify/AppInstallation/1' } },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { metafieldsSet: { metafields: [], userErrors: [] } } }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await syncWebchatAppMetafield({
      shopDomain: 'pilar-test.myshopify.com',
      accessToken: 'token',
      widgetKey: 'wk_test',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(second.variables.metafields).toEqual([
      {
        ownerId: 'gid://shopify/AppInstallation/1',
        namespace: 'riverz',
        key: 'widget_key',
        type: 'single_line_text_field',
        value: 'wk_test',
      },
    ])
  })
})

describe('shopifyScopes', () => {
  it('no amplía permisos de catálogo en la app pública', () => {
    expect(shopifyScopes('public')).not.toContain('write_products')
    expect(shopifyScopes('public')).not.toContain('write_inventory')
    expect(shopifyScopes('public')).not.toContain('write_script_tags')
  })

  it('limita la migración del laboratorio a la app legacy', () => {
    expect(shopifyScopes('legacy')).toContain('write_products')
    expect(shopifyScopes('legacy')).toContain('read_inventory')
    expect(shopifyScopes('legacy')).toContain('write_inventory')
    expect(shopifyScopes('legacy')).toContain('read_locations')
    expect(shopifyScopes('legacy')).toContain('read_script_tags')
    expect(shopifyScopes('legacy')).toContain('write_script_tags')
  })
})
