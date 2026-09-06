/**
 * Crea o reutiliza un producto UNLISTED para probar el chat en una tienda real.
 *
 * Uso:
 *   npx tsx scripts/create-shopify-webchat-lab.ts \
 *     --shop j9kgap-kn.myshopify.com \
 *     --source serum-pilar \
 *     --handle serum-pilar-prueba-chat \
 *     --title "Serum Pilar — Prueba chat"
 */
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '../src/lib/whatsapp/encryption'
import { shopifyApiVersion } from '../src/lib/shopify/oauth'
import { syncShopifyProducts } from '../src/lib/shopify/product-sync'

interface ProductNode {
  id: string
  handle: string
  title: string
  status: string
  variants?: {
    nodes?: Array<{
      id?: string
      inventoryPolicy?: string
      inventoryItem?: { tracked?: boolean }
    }>
  }
}

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? String(process.argv[index + 1] ?? '').trim() : ''
}

async function main() {
  const shop = arg('shop')
  const sourceHandle = arg('source')
  const targetHandle = arg('handle')
  const title = arg('title')
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new Error('Falta --shop con un dominio *.myshopify.com válido')
  }
  for (const [name, value] of [
    ['source', sourceHandle],
    ['handle', targetHandle],
    ['title', title],
  ]) {
    if (!value) throw new Error(`Falta --${name}`)
  }
  if (!/^[a-z0-9][a-z0-9-]{1,120}$/.test(targetHandle)) {
    throw new Error('--handle no es válido')
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('Falta configurar Supabase')
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data: connection, error } = await db
    .from('shopify_connections')
    .select('user_id, workspace_id, access_token, scope')
    .eq('platform', 'shopify')
    .eq('shop_domain', shop)
    .eq('status', 'active')
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !connection) throw new Error(error?.message || 'Tienda no conectada')
  const scopes = String(connection.scope ?? '').split(',')
  if (!scopes.includes('write_products')) {
    throw new Error('La conexión no tiene write_products; reconecta la app legacy')
  }
  for (const required of ['read_inventory', 'write_inventory', 'read_locations']) {
    if (!scopes.includes(required)) {
      throw new Error(`La conexión no tiene ${required}; reconecta la app legacy`)
    }
  }
  const accessToken = decrypt(connection.access_token)
  const endpoint = `https://${shop}/admin/api/${shopifyApiVersion()}/graphql.json`

  async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    })
    const json = (await response.json()) as {
      data?: T
      errors?: Array<{ message?: string }>
    }
    if (!response.ok || json.errors?.length || !json.data) {
      throw new Error(json.errors?.[0]?.message || `Shopify GraphQL ${response.status}`)
    }
    return json.data
  }

  async function byHandle(handle: string): Promise<ProductNode | null> {
    const data = await graphql<{
      products: { nodes: ProductNode[] }
    }>(
      'query RiverzProductByHandle($query: String!) { products(first: 1, query: $query) { nodes { id handle title status variants(first: 1) { nodes { id } } } } }',
      { query: `handle:${handle}` },
    )
    return data.products.nodes[0] ?? null
  }

  let target = await byHandle(targetHandle)
  let created = false
  if (!target) {
    const source = await byHandle(sourceHandle)
    if (!source) throw new Error(`No existe el producto fuente ${sourceHandle}`)
    const duplicated = await graphql<{
      productDuplicate: {
        newProduct?: ProductNode
        userErrors?: Array<{ message?: string }>
      }
    }>(
      'mutation RiverzDuplicateProduct($productId: ID!, $title: String!) { productDuplicate(productId: $productId, newTitle: $title, newStatus: UNLISTED, includeImages: true, includeTranslations: true, synchronous: true) { newProduct { id handle title status variants(first: 1) { nodes { id } } } userErrors { message } } }',
      { productId: source.id, title },
    )
    const duplicateError = duplicated.productDuplicate.userErrors?.[0]?.message
    if (duplicateError || !duplicated.productDuplicate.newProduct) {
      throw new Error(duplicateError || 'Shopify no devolvió el producto duplicado')
    }
    target = duplicated.productDuplicate.newProduct
    created = true
  }

  if (target.handle !== targetHandle || target.status !== 'UNLISTED' || target.title !== title) {
    const updated = await graphql<{
      productUpdate: {
        product?: ProductNode
        userErrors?: Array<{ message?: string }>
      }
    }>(
      'mutation RiverzNormalizeLabProduct($product: ProductUpdateInput!) { productUpdate(product: $product) { product { id handle title status variants(first: 1) { nodes { id } } } userErrors { message } } }',
      { product: { id: target.id, handle: targetHandle, title, status: 'UNLISTED' } },
    )
    const updateError = updated.productUpdate.userErrors?.[0]?.message
    if (updateError || !updated.productUpdate.product) {
      throw new Error(updateError || 'No se pudo normalizar el producto de prueba')
    }
    target = updated.productUpdate.product
  }

  // Shopify copia también el saldo de inventario del producto fuente. En
  // Pilar ese saldo es negativo, así que el duplicado responde 422 "agotado"
  // aunque la política permita sobreventa. Este laboratorio recibe un stock
  // propio y pequeño; nunca se toca el inventario del Serum real.
  const variantData = await graphql<{
    product?: {
      variants?: {
        nodes?: Array<{
          id?: string
          inventoryPolicy?: string
          inventoryItem?: { tracked?: boolean }
        }>
      }
    }
  }>(
    'query RiverzLabVariants($id: ID!) { product(id: $id) { variants(first: 250) { nodes { id inventoryPolicy inventoryItem { tracked } } } } }',
    { id: target.id },
  )
  const variants = (variantData.product?.variants?.nodes ?? []).filter(
    (
      variant,
    ): variant is {
      id: string
      inventoryPolicy?: string
      inventoryItem?: { tracked?: boolean }
    } => Boolean(variant.id),
  )
  const blocked = variants.filter(
    (variant) =>
      variant.inventoryPolicy !== 'CONTINUE' || variant.inventoryItem?.tracked !== true,
  )
  if (blocked.length > 0) {
    const updated = await graphql<{
      productVariantsBulkUpdate: {
        productVariants?: Array<{
          id?: string
          inventoryPolicy?: string
          inventoryItem?: { tracked?: boolean }
        }>
        userErrors?: Array<{ message?: string }>
      }
    }>(
      'mutation RiverzKeepLabPurchasable($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { productVariants { id inventoryPolicy inventoryItem { tracked } } userErrors { message } } }',
      {
        productId: target.id,
        variants: blocked.map((variant) => ({
          id: variant.id,
          inventoryPolicy: 'CONTINUE',
          inventoryItem: { tracked: true },
        })),
      },
    )
    const variantError = updated.productVariantsBulkUpdate.userErrors?.[0]?.message
    if (variantError) throw new Error(variantError)
  }

  const inventoryData = await graphql<{
    product?: {
      variants?: {
        nodes?: Array<{
          id?: string
          sellableOnlineQuantity?: number
          inventoryItem?: {
            id?: string
            inventoryLevels?: {
              nodes?: Array<{
                location?: { id?: string }
                quantities?: Array<{ name?: string; quantity?: number }>
              }>
            }
          }
        }>
      }
    }
  }>(
    'query RiverzLabInventory($id: ID!) { product(id: $id) { variants(first: 250) { nodes { id sellableOnlineQuantity inventoryItem { id inventoryLevels(first: 20) { nodes { location { id } quantities(names: ["available"]) { name quantity } } } } } } } }',
    { id: target.id },
  )
  const stock = 10
  const quantities = (inventoryData.product?.variants?.nodes ?? []).flatMap((variant) => {
    const itemId = variant.inventoryItem?.id
    const level = variant.inventoryItem?.inventoryLevels?.nodes?.[0]
    const locationId = level?.location?.id
    const current = level?.quantities?.find((q) => q.name === 'available')?.quantity
    const sellable = Number(variant.sellableOnlineQuantity ?? 0)
    if (!itemId || !locationId || current == null || sellable >= stock) return []
    return [{
      inventoryItemId: itemId,
      locationId,
      quantity: current + (stock - sellable),
      compareQuantity: current,
    }]
  })
  if (quantities.length > 0) {
    const inventoried = await graphql<{
      inventorySetQuantities: { userErrors?: Array<{ message?: string }> }
    }>(
      'mutation RiverzStockLab($input: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $input) { inventoryAdjustmentGroup { reason } userErrors { message } } }',
      {
        input: {
          name: 'available',
          reason: 'correction',
          referenceDocumentUri: `riverz://webchat-lab/${targetHandle}`,
          quantities,
        },
      },
    )
    const inventoryError = inventoried.inventorySetQuantities.userErrors?.[0]?.message
    if (inventoryError) throw new Error(inventoryError)
  }

  target.variants = { nodes: variants }

  await syncShopifyProducts(db, {
    userId: connection.user_id,
    workspaceId: connection.workspace_id,
    shopDomain: shop,
    accessToken,
  })

  console.log(
    JSON.stringify({
      created,
      productId: target.id,
      variantId: target.variants?.nodes?.[0]?.id ?? null,
      status: target.status,
      url: `https://pilarargentina.store/products/${target.handle}`,
    }),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
