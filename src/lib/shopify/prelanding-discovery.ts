import { isPublicHttpsUrl } from '@/lib/security/url-guard'

const MAX_SITEMAPS = 16
const MAX_URLS = 300
const MAX_PAGES_TO_READ = 120
const MAX_PRELANDINGS_PER_PRODUCT = 4

export interface SitemapProduct {
  handle: string
}

export interface PrelandingDiscovery {
  ok: boolean
  byHandle: Map<string, string[]>
  scanned: number
}

export function prelandingHandleKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function canonicalUrl(value: string): string | null {
  const parsed = isPublicHttpsUrl(value)
  if (!parsed) return null
  parsed.hash = ''
  parsed.search = ''
  return parsed.toString().replace(/\/$/, '')
}

function sitemapLocations(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((match) => match[1].replace(/&amp;/g, '&').trim())
    .filter(Boolean)
}

function handlesInHtml(html: string, knownHandles: Set<string>): string[] {
  const found = new Set<string>()
  for (const match of html.matchAll(/\/products\/([^/?#"'\\<]+)/gi)) {
    const handle = prelandingHandleKey(decodeURIComponent(match[1]))
    if (knownHandles.has(handle)) found.add(handle)
  }
  return [...found]
}

function handleFromPath(url: string, knownHandles: Set<string>): string | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    const candidate = prelandingHandleKey(parts.at(-1) ?? '')
    return knownHandles.has(candidate) ? candidate : null
  } catch {
    return null
  }
}

async function readText(url: string, fetcher: typeof fetch): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetcher(url, {
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'application/xml,text/xml,text/html;q=0.9' },
    })
    if (!response.ok) return null
    return (await response.text()).slice(0, 500_000)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Encuentra pre-landings públicas creadas dentro de una tienda Shopify.
 *
 * Shopify publica el inventario de URLs de la tienda en sitemap.xml aunque la
 * app no tenga el permiso `read_content`. Leemos ese inventario con topes
 * claros y asociamos una página a un producto sólo si su slug coincide con el
 * handle o si el HTML enlaza a UN producto concreto. Así un blog o colección
 * genérica no termina como fuente de todos los productos.
 */
export async function discoverPrelandings(
  publicDomain: string,
  products: SitemapProduct[],
  fetcher: typeof fetch = fetch,
): Promise<PrelandingDiscovery> {
  const root = canonicalUrl(`https://${publicDomain}/sitemap.xml`)
  if (!root) return { ok: false, byHandle: new Map(), scanned: 0 }

  const knownHandles = new Set(
    products.map((product) => prelandingHandleKey(product.handle)).filter(Boolean),
  )
  if (knownHandles.size === 0) return { ok: true, byHandle: new Map(), scanned: 0 }

  const rootXml = await readText(root, fetcher)
  if (!rootXml) return { ok: false, byHandle: new Map(), scanned: 0 }

  let publicHost: string
  try {
    publicHost = new URL(root).hostname.toLowerCase()
  } catch {
    return { ok: false, byHandle: new Map(), scanned: 0 }
  }

  const locations = sitemapLocations(rootXml)
  const childSitemaps = locations
    .map(canonicalUrl)
    .filter((url): url is string => !!url && new URL(url).hostname.toLowerCase() === publicHost)
    .filter((url) => /sitemap/i.test(new URL(url).pathname))
    .slice(0, MAX_SITEMAPS)

  const urls = new Set<string>()
  const addLocation = (value: string) => {
    const url = canonicalUrl(value)
    if (!url || new URL(url).hostname.toLowerCase() !== publicHost) return
    if (/sitemap/i.test(new URL(url).pathname)) return
    urls.add(url)
  }

  // A store can expose a urlset directly instead of a sitemap index.
  for (const location of locations) addLocation(location)
  for (const sitemap of childSitemaps) {
    const xml = await readText(sitemap, fetcher)
    if (!xml) continue
    for (const location of sitemapLocations(xml)) addLocation(location)
    if (urls.size >= MAX_URLS) break
  }

  const byHandle = new Map<string, Set<string>>()
  const attach = (handle: string, url: string) => {
    const set = byHandle.get(handle) ?? new Set<string>()
    if (set.size < MAX_PRELANDINGS_PER_PRODUCT) set.add(url)
    byHandle.set(handle, set)
  }

  const candidates: string[] = []
  for (const url of [...urls].slice(0, MAX_URLS)) {
    if (new URL(url).pathname.startsWith('/products/')) continue
    const directHandle = handleFromPath(url, knownHandles)
    if (directHandle) attach(directHandle, url)
    else candidates.push(url)
  }

  // Las rutas de página con un nombre distinto al producto son las
  // pre-landings más frecuentes. Se leen en paralelo acotado por tandas.
  for (let index = 0; index < Math.min(candidates.length, MAX_PAGES_TO_READ); index += 4) {
    const batch = candidates.slice(index, index + 4)
    const pages = await Promise.all(
      batch.map(async (url) => ({ url, html: await readText(url, fetcher) })),
    )
    for (const page of pages) {
      if (!page.html) continue
      const handles = handlesInHtml(page.html, knownHandles)
      // Un artículo o una colección puede enlazar decenas de productos: no es
      // una pre-landing específica y no aporta contexto preciso.
      if (handles.length === 1) attach(handles[0], page.url)
    }
  }

  return {
    ok: true,
    byHandle: new Map([...byHandle].map(([handle, urls]) => [handle, [...urls]])),
    scanned: urls.size,
  }
}
