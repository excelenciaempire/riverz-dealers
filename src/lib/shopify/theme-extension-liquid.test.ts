import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Liquid } from 'liquidjs'
import { beforeAll, describe, expect, it } from 'vitest'

const liquid = new Liquid({ strictVariables: true })
let template = ''

beforeAll(async () => {
  template = await readFile(
    path.join(
      process.cwd(),
      'extensions/riverz-webchat/blocks/riverz-webchat.liquid',
    ),
    'utf8',
  )
  template = template.replace(/{% schema %}[\s\S]*{% endschema %}/, '')
})

async function render(args: {
  widgetKey?: string
  scope: 'all' | 'product'
  pageProductId?: string
  selectedProductId?: string
}) {
  return liquid.parseAndRender(template, {
    app: {
      metafields: {
        riverz: {
          widget_key: { value: args.widgetKey ?? '' },
        },
      },
    },
    block: {
      settings: {
        display_scope: args.scope,
        product: args.selectedProductId
          ? { id: args.selectedProductId }
          : null,
      },
    },
    product: args.pageProductId ? { id: args.pageProductId } : null,
  })
}

describe('riverz-webchat.liquid', () => {
  it('carga el widget en cualquier página con alcance global', async () => {
    expect(await render({ widgetKey: 'wk_1', scope: 'all' })).toContain(
      'data-riverz-key="wk_1"',
    )
  })

  it('carga el widget únicamente en el producto elegido', async () => {
    expect(
      await render({
        widgetKey: 'wk_1',
        scope: 'product',
        pageProductId: 'gid://shopify/Product/1',
        selectedProductId: 'gid://shopify/Product/1',
      }),
    ).toContain('data-riverz-key="wk_1"')
  })

  it('no carga el widget en un producto distinto', async () => {
    expect(
      await render({
        widgetKey: 'wk_1',
        scope: 'product',
        pageProductId: 'gid://shopify/Product/2',
        selectedProductId: 'gid://shopify/Product/1',
      }),
    ).not.toContain('widget/v1.js')
  })

  it('no carga el widget si falta la llave de Riverz', async () => {
    expect(await render({ scope: 'all' })).not.toContain('widget/v1.js')
  })
})
