/**
 * Targeted Shopify product lookups used by the AI agent + flows when it
 * needs to resolve a specific SKU, tag, or handle to a live product.
 *
 * - SKU search: GraphQL `productVariants(query: "sku:...")` — variant-level
 *   data, returns the parent product.
 * - Tag search: GraphQL `products(query: "tag:...")` — bulk listing.
 * - Handle search: REST /products.json?handle=X — single product, simplest
 *   path for a known handle.
 */

import { ShopifyAdminClient } from './admin-client'
import { shopifyApiVersion } from './oauth'

export interface ProductSearchHit {
  id: string
  handle: string
  title: string
  productType: string | null
  vendor: string | null
  tags: string[]
  imageUrl: string | null
  priceMin: number | null
  priceMax: number | null
  url: string
}

interface GraphqlProductNode {
  id: string
  handle: string
  title: string
  productType?: string | null
  vendor?: string | null
  tags?: string[] | null
  featuredImage?: { url?: string | null } | null
  priceRangeV2?: {
    minVariantPrice?: { amount?: string | null } | null
    maxVariantPrice?: { amount?: string | null } | null
  } | null
}

interface RestProduct {
  id: number
  handle: string
  title: string
  product_type?: string | null
  vendor?: string | null
  tags?: string | null
  image?: { src?: string | null } | null
  images?: { src?: string | null }[] | null
  variants?: { price?: string | null }[] | null
}

async function graphql<T>(
  shop: string,
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(
    `https://${shop}/admin/api/${shopifyApiVersion()}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Shopify GraphQL ${res.status}: ${text.slice(0, 300)}`)
  }
  const body = (await res.json()) as { data?: T; errors?: unknown[] }
  if (body.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(body.errors).slice(0, 300)}`)
  }
  return body.data as T
}

function nodeToHit(p: GraphqlProductNode, shopDomain: string): ProductSearchHit {
  const min = Number(p.priceRangeV2?.minVariantPrice?.amount ?? '')
  const max = Number(p.priceRangeV2?.maxVariantPrice?.amount ?? '')
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    productType: p.productType ?? null,
    vendor: p.vendor ?? null,
    tags: Array.isArray(p.tags) ? p.tags : [],
    imageUrl: p.featuredImage?.url ?? null,
    priceMin: Number.isFinite(min) && min > 0 ? min : null,
    priceMax: Number.isFinite(max) && max > 0 ? max : null,
    url: `https://${shopDomain}/products/${p.handle}`,
  }
}

function restToHit(p: RestProduct, shopDomain: string): ProductSearchHit {
  const tags = (p.tags ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const prices = (p.variants ?? [])
    .map((v) => Number(v.price))
    .filter((n) => Number.isFinite(n) && n > 0)
  return {
    id: `gid://shopify/Product/${p.id}`,
    handle: p.handle,
    title: p.title,
    productType: p.product_type ?? null,
    vendor: p.vendor ?? null,
    tags,
    imageUrl: p.image?.src ?? p.images?.[0]?.src ?? null,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    url: `https://${shopDomain}/products/${p.handle}`,
  }
}

/** Find products whose any variant carries the given SKU. */
export async function searchBySku(
  shopDomain: string,
  token: string,
  sku: string,
  limit = 10,
): Promise<ProductSearchHit[]> {
  const trimmed = sku.trim()
  if (!trimmed) return []
  const query = `
    query SearchBySku($q: String!, $n: Int!) {
      productVariants(first: $n, query: $q) {
        edges {
          node {
            product {
              id handle title productType vendor tags
              featuredImage { url }
              priceRangeV2 {
                minVariantPrice { amount }
                maxVariantPrice { amount }
              }
            }
          }
        }
      }
    }
  `
  type Resp = {
    productVariants: {
      edges: { node: { product: GraphqlProductNode } }[]
    }
  }
  const data = await graphql<Resp>(shopDomain, token, query, {
    q: `sku:${trimmed}`,
    n: limit,
  })
  const seen = new Set<string>()
  const hits: ProductSearchHit[] = []
  for (const edge of data.productVariants.edges) {
    const p = edge.node.product
    if (!p || seen.has(p.id)) continue
    seen.add(p.id)
    hits.push(nodeToHit(p, shopDomain))
  }
  return hits
}

/** Find products carrying the given tag (exact match, case-insensitive). */
export async function searchByTag(
  shopDomain: string,
  token: string,
  tag: string,
  limit = 25,
): Promise<ProductSearchHit[]> {
  const trimmed = tag.trim()
  if (!trimmed) return []
  const query = `
    query SearchByTag($q: String!, $n: Int!) {
      products(first: $n, query: $q) {
        edges {
          node {
            id handle title productType vendor tags
            featuredImage { url }
            priceRangeV2 {
              minVariantPrice { amount }
              maxVariantPrice { amount }
            }
          }
        }
      }
    }
  `
  type Resp = { products: { edges: { node: GraphqlProductNode }[] } }
  const data = await graphql<Resp>(shopDomain, token, query, {
    q: `tag:${trimmed}`,
    n: limit,
  })
  return data.products.edges.map((e) => nodeToHit(e.node, shopDomain))
}

/**
 * Look up a single product by its handle. Uses REST because Shopify's
 * handle filter on /products.json is exact-match and the cheapest path
 * for a known slug.
 */
export async function searchByHandle(
  shopDomain: string,
  token: string,
  handle: string,
): Promise<ProductSearchHit | null> {
  const trimmed = handle.trim().toLowerCase()
  if (!trimmed) return null
  const client = new ShopifyAdminClient(shopDomain, token)
  const data = await client.rest<{ products: RestProduct[] }>(
    `/products.json?handle=${encodeURIComponent(trimmed)}&limit=1`,
  )
  const product = data.products?.[0]
  return product ? restToHit(product, shopDomain) : null
}
