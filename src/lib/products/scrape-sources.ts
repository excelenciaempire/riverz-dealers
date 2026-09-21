import type { SupabaseClient } from '@supabase/supabase-js'
import { firecrawlScrape, FirecrawlError, workspaceDelProducto } from '@/lib/firecrawl/client'
import { isPublicHttpsUrl } from '@/lib/security/url-guard'
import { detectOffersFromScrapedContent } from '@/lib/shopify/offer-learning'
import type { Locale } from '@/lib/i18n/config'
import { buildTrainingMaterial } from './training-material'

/**
 * Leer la página del producto y guardar lo que dice.
 *
 * Es la base del conocimiento del agente: lo que está escrito en la página del
 * producto —los ingredientes, el modo de uso, las medidas, la garantía— casi
 * nunca está en la descripción que devuelve la API de la tienda, y es
 * exactamente lo que la gente pregunta.
 *
 * Vivía dentro de la ruta del botón "leer la página". Salió acá porque hacía
 * falta en un segundo lugar: cuando el comercio AGREGA una fuente, esa fuente
 * tiene que leerse sola. Antes se guardaba la URL y no pasaba nada — el
 * contenido viejo seguía ahí, el agente seguía sin saber, y no había forma de
 * enterarse salvo apretar el botón.
 */

export interface LecturaResultado {
  ok: boolean
  chars?: number
  sites?: number
  failed?: number
  offersDetected?: boolean
  error?: string
}

/** Las fuentes de un producto: la lista del editor, o la URL de siempre. */
export function fuentesDe(product: {
  websites?: unknown
  prelanding_urls?: unknown
  url?: unknown
}): string[] {
  const crudas = [
    ...(Array.isArray(product.websites) ? (product.websites as unknown[]) : []),
    ...(Array.isArray(product.prelanding_urls)
      ? (product.prelanding_urls as unknown[])
      : []),
    product.url,
  ]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
  // Sólo https público: esto sigue una URL que escribió alguien, así que un
  // host interno acá es una petición del servidor a la red privada.
  return [...new Set(crudas)].filter((u) => isPublicHttpsUrl(u)).slice(0, 5)
}

export async function leerFuentes(
  db: SupabaseClient,
  product: Record<string, unknown>,
  locale: Locale = 'es',
): Promise<LecturaResultado> {
  const id = String(product.id ?? '')
  const sites = fuentesDe(product)
  if (!id || sites.length === 0) return { ok: false, error: 'sin_fuentes' }

  // Se marca antes de la llamada externa: la lectura tarda y el editor
  // consulta este estado para poder mostrar que está en curso.
  await db
    .from('shopify_products')
    .update({ scrape_status: 'scraping', scrape_error: null })
    .eq('id', id)

  try {
    // El presupuesto de caracteres se reparte entre las fuentes para que el
    // material combinado quede acotado. Una URL que falla no hunde al resto.
    const perUrl = Math.max(2_000, Math.floor(14_000 / sites.length))
    const chunks: string[] = []
    const htmlChunks: string[] = []
    const failures: string[] = []
    for (const site of sites) {
      try {
        const scraped = await firecrawlScrape(site, {
          maxChars: perUrl,
          cobrarA: workspaceDelProducto(db, product),
        })
        if (scraped.markdown.trim()) {
          chunks.push(sites.length > 1 ? `## ${site}\n\n${scraped.markdown}` : scraped.markdown)
        }
        if (scraped.html) htmlChunks.push(scraped.html)
      } catch (e) {
        failures.push(`${site}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (chunks.length === 0) throw new Error(failures.join(' · ') || 'Sin contenido')

    const markdown = chunks.join('\n\n---\n\n')
    await db
      .from('shopify_products')
      .update({
        scrape_status: 'done',
        scraped_content: markdown,
        scraped_at: new Date().toISOString(),
        scrape_error: failures.length
          ? `Algunas URLs fallaron — ${failures.join(' · ')}`
          : null,
      })
      .eq('id', id)

    const detectadas = await detectOffersFromScrapedContent(
      db,
      { ...product, id },
      { markdown, html: htmlChunks.join('\n') },
      locale === 'en' ? 'en' : 'es',
    )
    // scraped_content is only storage; the assistant reads training_material.
    // Recompile after offer detection so the very next reply gets the current
    // page, every source and the current tier values.
    const { data: refreshed } = await db
      .from('shopify_products')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (refreshed) {
      await db
        .from('shopify_products')
        .update({ training_material: buildTrainingMaterial(refreshed, locale === 'en' ? 'en' : 'es') })
        .eq('id', id)
    }
    return {
      ok: true,
      chars: markdown.length,
      sites: chunks.length,
      failed: failures.length,
      offersDetected: detectadas > 0,
    }
  } catch (err) {
    const msg =
      err instanceof FirecrawlError
        ? `${err.status}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err)
    await db
      .from('shopify_products')
      .update({ scrape_status: 'failed', scrape_error: msg })
      .eq('id', id)
    return { ok: false, error: msg }
  }
}
